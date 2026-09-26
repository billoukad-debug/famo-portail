window.FamoDocuments=(()=>{
  const esc=value=>String(value||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const eur=value=>{const n=Number(value||0);const s=Math.abs(n).toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");return "€ "+(n<0?"-":"")+s;};
  const qtyTxt=value=>{const n=Number(String(value==null?"":value).replace(",","."));return Number.isFinite(n)?String(Math.round(n*1000)/1000).replace(".",","):String(value||"");};
  const parse=lines=>String(lines||"").split("\n").filter(Boolean).map(raw=>{const m=raw.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^\[\(]*)(.*)$/);if(!m)return{name:raw,qty:"",unit:"",price:null,comment:""};const tail=m[4]||"",price=tail.match(/\[€\s*([\d.,]+)\]/),comment=tail.match(/\((.*?)\)/);return{name:m[1].trim(),qty:m[2],unit:m[3].trim(),price:price?Number(price[1].replace(",",".")):null,comment:comment?comment[1]:""}});
  const toDate=value=>{if(!value)return null;const d=new Date(String(value).includes("T")?value:value+"T00:00:00");return Number.isNaN(d.getTime())?null:d;};
  const date=value=>{if(!value)return"—";const d=toDate(value);if(!d)return String(value);const p=n=>String(n).padStart(2,"0");return p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear();};
  // Datum + n dagen (vervaldatum). Ongeldige datum → leeg.
  const addDays=(value,days)=>{const d=toDate(value);if(!d)return"";d.setDate(d.getDate()+Number(days||0));return d.toISOString();};
  const todayIso=()=>new Date().toISOString();
  const todayBrussels=()=>{try{return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels"}).format(new Date());}catch(e){return new Date().toISOString().slice(0,10);}};
  // Company identity from /api/config. Missing IBAN/BIC → temporary example bank (banner on invoice).
  let COMPANY={
    nom:"",
    adresse:"",
    cp:"",
    tva:"",
    tel:"",
    iban:"",
    bic:"",
    btwTarief:6,
    betaaltermijnDagen:14,
    betalingsvoorwaarden:"",
    leveringsvoorwaarden:"",
    exampleBank:false
  };
  function setCompany(cfg){
    const base=window.famoCompany?famoCompany.normalize(cfg):{
      nom:String(cfg&& (cfg.nom||cfg.bedrijfsnaam)||"").trim(),
      adresse:String(cfg&& (cfg.adresse||cfg.adres)||"").trim(),
      cp:String(cfg&& (cfg.cp||cfg.plaats)||"").trim(),
      tva:String(cfg&& (cfg.tva||cfg.btw)||"").trim(),
      tel:String(cfg&& (cfg.tel||cfg.telefoon)||"").trim(),
      iban:String(cfg&&cfg.iban||"").trim(),
      bic:String(cfg&&cfg.bic||"").trim()
    };
    const tarief=Number(cfg&&cfg.btwTarief);
    base.btwTarief=Number.isFinite(tarief)&&tarief>0?tarief:6;
    const termijn=Number(cfg&&cfg.betaaltermijnDagen);
    base.betaaltermijnDagen=Number.isFinite(termijn)&&termijn>0?Math.round(termijn):14;
    base.betalingsvoorwaarden=String(cfg&&cfg.betalingsvoorwaarden||"").trim();
    base.leveringsvoorwaarden=String(cfg&&cfg.leveringsvoorwaarden||"").trim();
    COMPANY=window.famoCompany?famoCompany.withExampleBank(base):Object.assign({exampleBank:false},base);
    return COMPANY;
  }
  // IBAN et nom obligatoires ; le BIC est facultatif (virement SEPA belge) et n'apparaît que s'il existe.
  function canInvoice(){
    return !!(COMPANY.iban && COMPANY.nom);
  }
  function invoiceBlockReason(){
    if(!COMPANY.nom) return "Bedrijfsgegevens ontbreken. Vul ze in via Beheer.";
    if(!COMPANY.iban) return "Factuur geblokkeerd: IBAN ontbreekt. Vul het in via Beheer.";
    return "";
  }
  function usingExampleBank(){ return !!COMPANY.exampleBank; }
  // Gestructureerde mededeling (OGM) afgeleid van het factuurnummer : FA-2026-0001 → +++202/6000/00192+++.
  // Basis = jaar + volgnummer op 6 cijfers, controle = basis mod 97 (0 → 97). Onbekend formaat → leeg.
  const structuredRef=invoiceNumber=>{
    const m=String(invoiceNumber||"").trim().match(/^FA-(\d{4})-(\d{1,6})$/i);
    if(!m)return"";
    const base=m[1]+m[2].padStart(6,"0");
    const digits=base+String(Number(base)%97||97).padStart(2,"0");
    return"+++"+digits.slice(0,3)+"/"+digits.slice(3,7)+"/"+digits.slice(7)+"+++";
  };
  const number=(order,type)=>{
    if(type==="invoice") return order.factuurnummer||"—";
    if(type==="credit") return (order.creditnota&&order.creditnota.nummer)||("CN-"+String(order.factuurnummer||order.ref||"").replace(/^FA-/i,"").replace(/^CMD-/i,""));
    return "LB-"+String(order.ref||"").replace(/^CMD-/,"");
  };
  // Bestandsnaam voor een bundel (buildMany) : één PDF per dag.
  const filenameMany=type=>{
    const day=todayBrussels();
    if(typeof window!=="undefined"&&window.famoDocPreview&&window.famoDocPreview.filenameFor){
      if(type==="delivery") return window.famoDocPreview.filenameFor("deliveries",{date:day});
      if(type==="invoice") return window.famoDocPreview.filenameFor("invoices",{date:day});
      if(type==="credit") return window.famoDocPreview.filenameFor("credits",{date:day});
    }
    const safe=v=>String(v||"document").replace(/[^\w.\-]+/g,"-");
    if(type==="invoice") return "Famo-Facturen-"+safe(day)+".pdf";
    if(type==="credit") return "Famo-Creditnotas-"+safe(day)+".pdf";
    return "Famo-Leveringsbonnen-"+safe(day)+".pdf";
  };
  // Btw-tarief van een lijn : order.btwPerLine = { "productnaam (kleine letters)": tarief }, anders bedrijfstarief.
  const rateMap=order=>{const m=order&&order.btwPerLine;return m&&typeof m==="object"&&!Array.isArray(m)&&Object.keys(m).length?m:null;};
  const rateFor=(name,map,fallback)=>{
    if(!map)return fallback;
    const key=String(name||"").trim().toLowerCase();
    const found=Object.keys(map).find(k=>String(k).trim().toLowerCase()===key);
    const r=found==null?NaN:Number(map[found]);
    return Number.isFinite(r)&&r>=0?r:fallback;
  };
  const cents=n=>Math.round(n*100)/100;
  const filename=(order,type)=>{
    if(typeof window!=="undefined"&&window.famoDocPreview&&window.famoDocPreview.filenameFor){
      if(type==="invoice") return window.famoDocPreview.filenameFor("invoice",{number:order.factuurnummer||order.ref,ref:order.ref});
      if(type==="credit") return window.famoDocPreview.filenameFor("credit",{number:number(order,"credit"),ref:order.ref});
      return window.famoDocPreview.filenameFor("delivery",{ref:order.ref||"CMD",number:number(order,"delivery")});
    }
    const safe=v=>String(v||"document").replace(/[^\w.\-]+/g,"-");
    if(type==="invoice") return "Famo-Factuur-"+safe(order.factuurnummer||order.ref||"FA")+".pdf";
    if(type==="credit") return "Famo-Creditnota-"+safe(number(order,"credit"))+".pdf";
    return "Famo-Leveringsbon-"+safe(order.ref||"CMD")+".pdf";
  };
  // Kern van build/buildMany : {title, css, body} — build verpakt het in een volledig document.
  function render(order,type){
    const invoice=type==="invoice", credit=type==="credit", priced=invoice||credit;
    if(invoice && !canInvoice()){
      throw new Error(invoiceBlockReason());
    }
    const cn=credit?(order.creditnota||null):null;
    if(credit && !(cn&&cn.nummer)){
      throw new Error("Nog geen creditnota voor deze bestelling.");
    }
    const sign=credit?-1:1;
    const rows=parse(credit?cn.lignes:order.lignes);
    // Prix du catalogue et total de commande HORS TVA (Beheer : « exclusief btw ») : la TVA s'ajoute,
    // arrondie au centime. Avant, elle était retranchée d'un total supposé TTC (≈ 6 % de trop peu).
    const pct=Number(COMPANY.btwTarief)>0?Number(COMPANY.btwTarief):6;
    const map=priced?rateMap(order):null;
    const baseTotal=credit?(cn.montant==null?order.total:cn.montant):order.total;
    // Btw per groep (tarief → grondslag), elk afgerond op de cent. Zonder btwPerLine : één groep = oud gedrag.
    let htva, groups;
    if(map && rows.some(r=>r.price!=null)){
      const acc=new Map();
      rows.forEach(row=>{
        if(row.price==null)return;
        const qty=Number(String(row.qty).replace(",","."))||0;
        const rate=rateFor(row.name,map,pct);
        acc.set(rate,(acc.get(rate)||0)+row.price*qty*sign);
      });
      groups=Array.from(acc.entries()).sort((a,b)=>a[0]-b[0]).map(([rate,base])=>({rate,base:cents(base)}));
      htva=cents(groups.reduce((s,g)=>s+g.base,0));
    }else{
      htva=cents(Number(baseTotal||0)*sign);
      groups=[{rate:pct,base:htva}];
    }
    groups.forEach(g=>{g.tva=Math.round(g.base*g.rate)/100;});
    const tva=cents(groups.reduce((s,g)=>s+g.tva,0));
    const total=cents(htva+tva);
    const num=number(order,type);
    const title=credit?"CREDITNOTA":(invoice?"FACTUUR":"LEVERINGSBON");
    // Rendu uniquement à partir d'ici — parse/calculs inchangés (parité M6).
    const nlUnit=value=>(typeof window!=="undefined"&&window.famoNL)?famoNL.unit(value):value;
    const ibanFmt=value=>String(value||"").replace(/\s+/g,"").replace(/(.{4})/g,"$1 ").trim();
    const ogm=invoice?structuredRef(order.factuurnummer):"";
    const lineRows=rows.map(row=>{
      const qty=Number(String(row.qty).replace(",","."))||0;
      const unitPrice=row.price==null?null:row.price*sign;
      const sub=unitPrice==null?null:unitPrice*qty;
      return '<tr><td>'+esc(row.name)+(row.comment?'<small>'+esc(row.comment)+'</small>':'')+'</td><td class="num">'+esc(qtyTxt(row.qty))+'</td><td>'+esc(nlUnit(row.unit))+'</td>'+(priced?'<td class="num">'+(unitPrice==null?'—':eur(unitPrice))+'</td><td class="num">'+(sub==null?'—':eur(sub))+'</td>':'')+'</tr>';
    }).join("");
    const bank='<div class="bank"><div class="banklabel">Bankgegevens</div>'+
      '<div class="bankrow"><span>Begunstigde</span><b>'+esc(COMPANY.nom)+'</b></div>'+
      '<div class="bankrow"><span>IBAN</span><b class="mono">'+esc(ibanFmt(COMPANY.iban))+'</b></div>'+
      (COMPANY.bic?'<div class="bankrow"><span>BIC</span><b class="mono">'+esc(COMPANY.bic)+'</b></div>':'')+
      (ogm?'<div class="bankrow"><span>Mededeling</span><b class="mono">'+esc(ogm)+'</b></div>':'')+
      (COMPANY.exampleBank?'<div class="bankexample"><em>Voorbeeld — nog niet definitief</em></div>':'')+
      '</div>';
    // Betaalstatus enkel wanneer betaald (met datum indien gekend).
    const paid=String(order.paiement||"")==="Payé"||/^(betaald|payé)$/i.test(String(order.paiement||""));
    const paidTxt=paid?("Betaald"+(order.payeLe?" op "+date(order.payeLe):"")):"";
    const terms=COMPANY.betalingsvoorwaarden?esc(COMPANY.betalingsvoorwaarden):"";
    const foot=credit
      ? 'Creditnota op factuur '+esc(order.factuurnummer||"—")+'.'+(cn.motif?' Reden: '+esc(cn.motif)+'.':'')+(terms?' '+terms:'')
      : (invoice
        ? terms
        : esc(COMPANY.leveringsvoorwaarden||'Goederen ontvangen in goede staat en conform.').replace(/\n/g,'<br>'));
    const banners=(invoice&&COMPANY.exampleBank?'<div class="banner"><b>Voorbeeld bankgegevens.</b> '+(window.famoCompany?esc(famoCompany.EXAMPLE.label):'Vervang IBAN/BIC via Beheer vóór echte facturatie.')+'</div>':'');
    // Monogramme F-houle : le F de Famo dont la barre médiane est une houle — trait accent.
    const mark='<svg width="30" height="30" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="#4876A2" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 14.25V1.75h9.5"/><path d="M3.75 8h3.05c1.5 0 1.85-1.4 3.35-1.4s1.6 1.4 3.1 1.4"/></g></svg>';
    const coords=[COMPANY.adresse,COMPANY.cp,COMPANY.tva?"BTW "+COMPANY.tva:"",COMPANY.tel].filter(Boolean).map(esc).join("<br>");
    const mast='<header class="mast"><div class="brand">'+mark+'<div class="wordmark">'+esc(COMPANY.nom||"—")+'</div></div><div class="coords">'+(coords||'<em>Bedrijfsgegevens niet geladen</em>')+'</div></header>';
    const klant=order.klant||{};
    const metaCell=(label,value,mono)=>value?'<div><div class="metalabel">'+label+'</div><div class="metavalue'+(mono?' mono':'')+'">'+esc(value)+'</div></div>':'';
    // Datums : factuur = Facturée le (anders vandaag) + vervaldatum ; creditnota = datum creditnota ;
    // leveringsbon = Livrée le (anders vandaag).
    const factuurdatum=invoice?(order.factureeLe||todayIso()):"";
    const vervaldatum=invoice?addDays(factuurdatum,COMPANY.betaaltermijnDagen):"";
    const leverdatum=invoice?(order.livreeLe||order.dateLiv||""):(order.dateLiv||"");
    const dates=credit
      ? metaCell("Creditnotadatum",date(cn.le||todayIso()))
      : (invoice
        ? metaCell("Factuurdatum",date(factuurdatum))+metaCell("Vervaldatum",date(vervaldatum))+(leverdatum?metaCell("Leverdatum",date(leverdatum)):"")
        : metaCell("Datum",date(order.livreeLe||todayIso()))+(leverdatum?metaCell("Leverdatum",date(leverdatum)):""));
    const metaband='<div class="metaband">'+
      metaCell("Document",num,true)+
      metaCell("Bestelling",order.ref,true)+
      (!invoice&&order.factuurnummer?metaCell("Factuur",order.factuurnummer,true):"")+
      dates+
      (klant.klantnr?metaCell("Klantnummer",klant.klantnr,true):"")+
      (invoice&&paidTxt?metaCell("Betaalstatus",paidTxt):"")+
      '</div>';
    const klantBlock='<section class="party"><h2>Klant</h2><div class="partyname">'+esc(order.client)+'</div>'+
      (klant.adresse?'<div class="partymeta">'+esc(klant.adresse).replace(/\n/g,"<br>")+'</div>':'')+
      (klant.btw?'<div class="partymeta">BTW '+esc(klant.btw)+'</div>':'')+
      '</section>';
    const table='<table><thead><tr><th>Beschrijving</th><th class="num">Aantal</th><th>Eenheid</th>'+
      (priced?'<th class="num">Eenheidsprijs</th><th class="num">Subtotaal</th>':'')+
      '</tr></thead><tbody>'+lineRows+'</tbody></table>';
    const totals='<div class="totals">'+
      '<div class="trow"><span>Totaal excl. btw</span><span>'+eur(htva)+'</span></div>'+
      groups.map(g=>'<div class="trow"><span>btw '+esc(String(g.rate).replace(".",","))+'%'+(groups.length>1?' <small>(op '+esc(eur(g.base))+')</small>':'')+'</span><span>'+eur(g.tva)+'</span></div>').join("")+
      '<div class="trow grand"><span>Totaal incl. btw</span><span>'+eur(total)+'</span></div>'+
      '</div>';
    const css='*{box-sizing:border-box}'+
      'body{font-family:"Helvetica Neue",Arial,sans-serif;color:#232323;margin:0;padding:38px 42px 32px;font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
      'em{font-style:italic}'+
      '.mast{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}'+
      '.brand{display:flex;align-items:center;gap:12px}'+
      '.brand svg{display:block;flex:none}'+
      '.wordmark{font-size:14px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}'+
      '.coords{text-align:right;font-size:10.5px;line-height:1.65;color:rgba(35,35,35,.62)}'+
      'h1{margin:30px 0 0;font-family:Georgia,"Iowan Old Style",serif;font-size:26px;font-weight:500;letter-spacing:-.012em}'+
      '.metaband{display:flex;flex-wrap:wrap;margin-top:14px;border-top:1px solid #E3E0D6;border-bottom:1px solid #E3E0D6}'+
      '.metaband>div{padding:9px 20px 10px 0}'+
      '.metaband>div+div{border-left:1px solid #E3E0D6;padding-left:20px}'+
      '.metalabel{font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(35,35,35,.62)}'+
      '.metavalue{margin-top:3px;font-size:12px}'+
      '.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}'+
      '.banner{margin-top:14px;padding:10px 13px;border:1px solid #E3E0D6;border-radius:12px;background:#FAF9F5;color:#7A5410;font-size:11px;line-height:1.5}'+
      '.party{margin-top:24px}'+
      'h2{margin:0 0 6px;font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(35,35,35,.62)}'+
      '.partyname{font-size:14px;font-weight:600}'+
      '.partymeta{margin-top:3px;font-size:11.5px;line-height:1.55;color:rgba(35,35,35,.70)}'+
      'table{width:100%;border-collapse:collapse;margin-top:26px}'+
      'thead th{padding:8px 10px;background:#F1EFE8;border-bottom:1px solid #E3E0D6;text-align:left;font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(35,35,35,.62)}'+
      'td{padding:10px;border-bottom:1px solid #E3E0D6;text-align:left;vertical-align:top;font-size:12px}'+
      'td small{display:block;margin-top:2px;font-size:10.5px;color:rgba(35,35,35,.62)}'+
      '.num{text-align:right;white-space:nowrap}'+
      '.totals{width:280px;max-width:100%;margin:8px 0 0 auto}'+
      '.trow{display:flex;justify-content:space-between;gap:16px;padding:6px 10px;color:rgba(35,35,35,.70)}'+
      '.trow span:last-child{color:#232323}'+
      '.grand{margin-top:4px;border-top:2px solid #232323;padding-top:10px;font-size:18px;font-weight:600;color:#232323}'+
      '.bank{margin-top:24px;padding:13px 16px;border:1px solid #E3E0D6;border-radius:12px;background:#FAF9F5;font-size:11.5px;page-break-inside:avoid}'+
      '.banklabel{margin-bottom:6px;font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(35,35,35,.62)}'+
      '.bankrow{display:flex;gap:14px;padding:2px 0}'+
      '.bankrow span{flex:none;width:92px;color:rgba(35,35,35,.62)}'+
      '.bankrow b{font-weight:600}'+
      '.bankexample{margin-top:6px;color:#7A5410}'+
      '.foot{margin-top:30px;border-top:1px solid #E3E0D6;padding-top:10px;font-size:9px;line-height:1.7;color:rgba(35,35,35,.62)}'+
      '.trow small{font-size:10px;color:rgba(35,35,35,.55)}'+
      '.doc+.doc{margin-top:38px}'+
      '@media print{thead{display:table-header-group}tr{page-break-inside:avoid}.totals,.banner,.metaband{page-break-inside:avoid}.doc+.doc{margin-top:0}}';
    const body=mast+'<h1>'+title+'</h1>'+metaband+banners+klantBlock+table+
      (priced?totals+(invoice?bank:''):'')+
      '<div class="foot">'+foot+'</div>';
    return{num,title,css,body};
  }
  const wrap=(titleTxt,css,inner)=>'<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>'+esc(titleTxt)+'</title><style>'+css+'</style></head><body>'+inner+'</body></html>';
  function build(order,type){
    const r=render(order,type);
    return wrap(r.num,r.css,r.body);
  }
  // Meerdere documenten in één HTML (één <style>), elk op een eigen pagina.
  function buildMany(orders,type){
    const list=(orders||[]).map(o=>render(o,type));
    if(!list.length) throw new Error("Geen documenten om te bundelen.");
    const inner=list.map((r,i)=>'<div class="doc">'+r.body+'</div>'+(i<list.length-1?'<div style="page-break-after:always"></div>':'')).join("");
    return wrap(list.length===1?list[0].num:list[0].title+" ("+list.length+")",list[0].css,inner);
  }
  return{build,buildMany,number,structuredRef,filename,filenameMany,parse,eur,esc,date,setCompany,getCompany:()=>COMPANY,canInvoice,invoiceBlockReason,usingExampleBank};
})();

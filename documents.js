window.FamoDocuments=(()=>{
  const esc=value=>String(value||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const eur=value=>"€ "+Number(value||0).toFixed(2).replace(".",",");
  const parse=lines=>String(lines||"").split("\n").filter(Boolean).map(raw=>{const m=raw.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^\[\(]*)(.*)$/);if(!m)return{name:raw,qty:"",unit:"",price:null,comment:""};const tail=m[4]||"",price=tail.match(/\[€\s*([\d.,]+)\]/),comment=tail.match(/\((.*?)\)/);return{name:m[1].trim(),qty:m[2],unit:m[3].trim(),price:price?Number(price[1].replace(",",".")):null,comment:comment?comment[1]:""}});
  const date=value=>{if(!value)return"—";const d=new Date(String(value).includes("T")?value:value+"T00:00:00");return Number.isNaN(d)?value:d.toLocaleDateString("nl-BE")};
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
    base.betalingsvoorwaarden=String(cfg&&cfg.betalingsvoorwaarden||"").trim();
    base.leveringsvoorwaarden=String(cfg&&cfg.leveringsvoorwaarden||"").trim();
    COMPANY=window.famoCompany?famoCompany.withExampleBank(base):Object.assign({exampleBank:false},base);
    return COMPANY;
  }
  function canInvoice(){
    return !!(COMPANY.iban && COMPANY.bic && COMPANY.nom);
  }
  function invoiceBlockReason(){
    if(!COMPANY.nom) return "Bedrijfsgegevens ontbreken. Vul ze in via Beheer.";
    if(!COMPANY.iban||!COMPANY.bic) return "Factuur geblokkeerd: IBAN/BIC ontbreken. Vul ze in via Beheer.";
    return "";
  }
  function usingExampleBank(){ return !!COMPANY.exampleBank; }
  function companyBlock(){
    if(!COMPANY.nom) return "<em>Bedrijfsgegevens niet geladen</em>";
    return esc(COMPANY.nom)+"<br>"+esc(COMPANY.adresse)+"<br>"+esc(COMPANY.cp)+
      (COMPANY.tva?"<br>BTW "+esc(COMPANY.tva):"")+
      (COMPANY.tel?"<br>"+esc(COMPANY.tel):"");
  }
  const number=(order,type)=>{
    if(type==="invoice") return order.factuurnummer||"—";
    if(type==="credit") return "CN-"+String(order.factuurnummer||order.ref||"").replace(/^FA-/i,"").replace(/^CMD-/i,"");
    return "LB-"+String(order.ref||"").replace(/^CMD-/,"");
  };
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
  function build(order,type){
    const invoice=type==="invoice", credit=type==="credit", priced=invoice||credit;
    if(invoice && !canInvoice()){
      throw new Error(invoiceBlockReason());
    }
    const sign=credit?-1:1;
    const rows=parse(order.lignes);
    const total=Number(order.total||0)*sign;
    const pct=Number(COMPANY.btwTarief)>0?Number(COMPANY.btwTarief):6;
    const htva=total/(1+pct/100), tva=total-htva;
    const num=number(order,type);
    const title=credit?"CREDITNOTA (VOORBEELD)":(invoice?"FACTUUR":"LEVERINGSBON");
    // Rendu uniquement à partir d'ici — parse/calculs inchangés (parité M6).
    const nlUnit=value=>(typeof window!=="undefined"&&window.famoNL)?famoNL.unit(value):value;
    const ibanFmt=value=>String(value||"").replace(/\s+/g,"").replace(/(.{4})/g,"$1 ").trim();
    const lineRows=rows.map(row=>{
      const qty=Number(String(row.qty).replace(",","."))||0;
      const unitPrice=row.price==null?null:row.price*sign;
      const sub=unitPrice==null?null:unitPrice*qty;
      return '<tr><td>'+esc(row.name)+(row.comment?'<small>'+esc(row.comment)+'</small>':'')+'</td><td class="num">'+esc(row.qty)+'</td><td>'+esc(nlUnit(row.unit))+'</td>'+(priced?'<td class="num">'+(unitPrice==null?'—':eur(unitPrice))+'</td><td class="num">'+(sub==null?'—':eur(sub))+'</td>':'')+'</tr>';
    }).join("");
    const bank='<div class="bank"><div class="banklabel">Bankgegevens</div>'+
      '<div class="bankrow"><span>Begunstigde</span><b>'+esc(COMPANY.nom)+'</b></div>'+
      '<div class="bankrow"><span>IBAN</span><b class="mono">'+esc(ibanFmt(COMPANY.iban))+'</b></div>'+
      (COMPANY.bic?'<div class="bankrow"><span>BIC</span><b class="mono">'+esc(COMPANY.bic)+'</b></div>':'')+
      (COMPANY.exampleBank?'<div class="bankexample"><em>Voorbeeld — nog niet definitief</em></div>':'')+
      '</div>';
    const payLabel=(typeof window!=="undefined"&&window.famoNL)?famoNL.pay(order.paiement||"En attente"):(order.paiement||"Openstaand");
    const foot=credit
      ? '<b>Voorbeeld / intern document.</b> Geen Airtable-creditnota, geen officieel nummer, geen Peppol. Alleen ter referentie.'
      : (invoice
        ? 'Betaalstatus: '+esc(payLabel)+'.'+(COMPANY.betalingsvoorwaarden?' '+esc(COMPANY.betalingsvoorwaarden):'')+' Intern document — geen automatische Peppol/Billtobox-verzending.'
        : 'Handtekening klant: ______________________________<br><br>'+esc(COMPANY.leveringsvoorwaarden||'Goederen ontvangen in goede staat en conform.').replace(/\n/g,'<br>'));
    const banners=(credit?'<div class="banner"><b>Voorbeeld — niet geboekt.</b> Creditnota (intern) zonder Airtable-nummer; niet automatisch verzonden.</div>':'')+
      (invoice&&COMPANY.exampleBank?'<div class="banner"><b>Voorbeeld bankgegevens.</b> '+(window.famoCompany?esc(famoCompany.EXAMPLE.label):'Vervang IBAN/BIC via Beheer vóór echte facturatie.')+'</div>':'');
    // Monogramme F-houle : le F de Famo dont la barre médiane est une houle — trait accent.
    const mark='<svg width="30" height="30" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="#0C6157" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 14.25V1.75h9.5"/><path d="M3.75 8h3.05c1.5 0 1.85-1.4 3.35-1.4s1.6 1.4 3.1 1.4"/></g></svg>';
    const coords=[COMPANY.adresse,COMPANY.cp,COMPANY.tva?"BTW "+COMPANY.tva:"",COMPANY.tel].filter(Boolean).map(esc).join("<br>");
    const mast='<header class="mast"><div class="brand">'+mark+'<div class="wordmark">'+esc(COMPANY.nom||"—")+'</div></div><div class="coords">'+(coords||'<em>Bedrijfsgegevens niet geladen</em>')+'</div></header>';
    const klant=order.klant||{};
    const metaCell=(label,value,mono)=>value?'<div><div class="metalabel">'+label+'</div><div class="metavalue'+(mono?' mono':'')+'">'+esc(value)+'</div></div>':'';
    const metaband='<div class="metaband">'+
      metaCell("Document",num,true)+
      metaCell("Bestelling",order.ref,true)+
      (!invoice&&order.factuurnummer?metaCell("Factuur",order.factuurnummer,true):"")+
      metaCell("Datum",date(new Date().toISOString()))+
      (order.dateLiv?metaCell("Leverdatum",date(order.dateLiv)):"")+
      (klant.klantnr?metaCell("Klantnummer",klant.klantnr,true):"")+
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
      '<div class="trow"><span>btw '+esc(String(pct).replace(".",","))+'%</span><span>'+eur(tva)+'</span></div>'+
      '<div class="trow grand"><span>Totaal</span><span>'+eur(total)+'</span></div>'+
      '</div>';
    const css='*{box-sizing:border-box}'+
      'body{font-family:"Helvetica Neue",Arial,sans-serif;color:#191512;margin:0;padding:38px 42px 32px;font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
      'em{font-style:italic}'+
      '.mast{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}'+
      '.brand{display:flex;align-items:center;gap:12px}'+
      '.brand svg{display:block;flex:none}'+
      '.wordmark{font-size:14px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}'+
      '.coords{text-align:right;font-size:10.5px;line-height:1.65;color:rgba(25,21,18,.62)}'+
      'h1{margin:30px 0 0;font-family:Georgia,"Iowan Old Style",serif;font-size:26px;font-weight:500;letter-spacing:-.012em}'+
      '.metaband{display:flex;flex-wrap:wrap;margin-top:14px;border-top:1px solid #E5DDD3;border-bottom:1px solid #E5DDD3}'+
      '.metaband>div{padding:9px 20px 10px 0}'+
      '.metaband>div+div{border-left:1px solid #E5DDD3;padding-left:20px}'+
      '.metalabel{font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(25,21,18,.62)}'+
      '.metavalue{margin-top:3px;font-size:12px}'+
      '.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}'+
      '.banner{margin-top:14px;padding:10px 13px;border:1px solid #E5DDD3;border-radius:12px;background:#FAF6F0;color:#8A6110;font-size:11px;line-height:1.5}'+
      '.party{margin-top:24px}'+
      'h2{margin:0 0 6px;font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(25,21,18,.62)}'+
      '.partyname{font-size:14px;font-weight:600}'+
      '.partymeta{margin-top:3px;font-size:11.5px;line-height:1.55;color:rgba(25,21,18,.70)}'+
      'table{width:100%;border-collapse:collapse;margin-top:26px}'+
      'thead th{padding:8px 10px;background:#F2ECE3;border-bottom:1px solid #E5DDD3;text-align:left;font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(25,21,18,.62)}'+
      'td{padding:10px;border-bottom:1px solid #E5DDD3;text-align:left;vertical-align:top;font-size:12px}'+
      'td small{display:block;margin-top:2px;font-size:10.5px;color:rgba(25,21,18,.62)}'+
      '.num{text-align:right;white-space:nowrap}'+
      '.totals{width:280px;max-width:100%;margin:8px 0 0 auto}'+
      '.trow{display:flex;justify-content:space-between;gap:16px;padding:6px 10px;color:rgba(25,21,18,.70)}'+
      '.trow span:last-child{color:#191512}'+
      '.grand{margin-top:4px;border-top:2px solid #191512;padding-top:10px;font-size:18px;font-weight:600;color:#191512}'+
      '.bank{margin-top:24px;padding:13px 16px;border:1px solid #E5DDD3;border-radius:12px;background:#FAF6F0;font-size:11.5px;page-break-inside:avoid}'+
      '.banklabel{margin-bottom:6px;font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:rgba(25,21,18,.62)}'+
      '.bankrow{display:flex;gap:14px;padding:2px 0}'+
      '.bankrow span{flex:none;width:92px;color:rgba(25,21,18,.62)}'+
      '.bankrow b{font-weight:600}'+
      '.bankexample{margin-top:6px;color:#8A6110}'+
      '.foot{margin-top:30px;border-top:1px solid #E5DDD3;padding-top:10px;font-size:9px;line-height:1.7;color:rgba(25,21,18,.62)}'+
      '@media print{thead{display:table-header-group}tr{page-break-inside:avoid}.totals,.banner,.metaband{page-break-inside:avoid}}';
    return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>'+esc(num)+'</title><style>'+css+'</style></head><body>'+
      mast+'<h1>'+title+'</h1>'+metaband+banners+klantBlock+table+
      (priced?totals+(invoice?bank:''):'')+
      '<div class="foot">'+foot+'</div></body></html>';
  }
  return{build,number,filename,parse,eur,esc,date,setCompany,getCompany:()=>COMPANY,canInvoice,invoiceBlockReason,usingExampleBank};
})();

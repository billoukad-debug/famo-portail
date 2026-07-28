window.FamoDocuments=(()=>{
  const esc=value=>String(value||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const eur=value=>"€ "+Number(value||0).toFixed(2).replace(".",",");
  const parse=lines=>String(lines||"").split("\n").filter(Boolean).map(raw=>{const m=raw.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^\[\(]*)(.*)$/);if(!m)return{name:raw,qty:"",unit:"",price:null,comment:""};const tail=m[4]||"",price=tail.match(/\[€\s*([\d.,]+)\]/),comment=tail.match(/\((.*?)\)/);return{name:m[1].trim(),qty:m[2],unit:m[3].trim(),price:price?Number(price[1].replace(",",".")):null,comment:comment?comment[1]:""}});
  const date=value=>{if(!value)return"—";const d=new Date(String(value).includes("T")?value:value+"T00:00:00");return Number.isNaN(d)?value:d.toLocaleDateString("nl-BE")};
  // No hardcoded fallback identity — must come from /api/config via setCompany.
  let COMPANY={
    nom:"",
    adresse:"",
    cp:"",
    tva:"",
    tel:"",
    iban:"",
    bic:""
  };
  function setCompany(cfg){
    cfg=cfg||{};
    COMPANY={
      nom:String(cfg.nom||cfg.bedrijfsnaam||"").trim(),
      adresse:String(cfg.adresse||cfg.adres||"").trim(),
      cp:String(cfg.cp||cfg.plaats||"").trim(),
      tva:String(cfg.tva||cfg.btw||"").trim(),
      tel:String(cfg.tel||cfg.telefoon||"").trim(),
      iban:String(cfg.iban||"").trim(),
      bic:String(cfg.bic||"").trim()
    };
    return COMPANY;
  }
  function canInvoice(){
    return !!(COMPANY.iban && COMPANY.bic && COMPANY.nom);
  }
  function invoiceBlockReason(){
    if(!COMPANY.nom) return "Bedrijfsgegevens ontbreken in Configuratie (Aan de slag).";
    if(!COMPANY.iban||!COMPANY.bic) return "Factuur geblokkeerd: IBAN/BIC ontbreken. Vul ze in via Aan de slag.";
    return "";
  }
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
    const htva=total/1.06, tva=total-htva;
    const num=number(order,type);
    const title=credit?"CREDITNOTA (VOORBEELD)":(invoice?"FACTUUR":"LEVERINGSBON");
    const lineRows=rows.map(row=>{
      const qty=Number(String(row.qty).replace(",","."))||0;
      const unitPrice=row.price==null?null:row.price*sign;
      const sub=unitPrice==null?null:unitPrice*qty;
      return '<tr><td>'+esc(row.name)+(row.comment?'<br><small>'+esc(row.comment)+'</small>':'')+'</td><td class="num">'+esc(row.qty)+'</td><td>'+esc(row.unit)+'</td>'+(priced?'<td class="num">'+(unitPrice==null?'—':eur(unitPrice))+'</td><td class="num">'+(sub==null?'—':eur(sub))+'</td>':'')+'</tr>';
    }).join("");
    const bank='<div class="bank"><b>Bankgegevens</b><br>'+esc(COMPANY.nom)+'<br>IBAN: '+esc(COMPANY.iban)+(COMPANY.bic?'<br>BIC: '+esc(COMPANY.bic):'')+'</div>';
    const foot=credit
      ? '<b>Voorbeeld / intern document.</b> Geen Airtable-creditnota, geen officieel nummer, geen Peppol. Alleen ter referentie.'
      : (invoice
        ? 'Betaalstatus: '+esc(order.paiement||"En attente")+'. Intern document — geen automatische Peppol/Billtobox-verzending.'
        : 'Handtekening klant: ______________________________<br><br>Goederen ontvangen in goede staat en conform.<br>Klachten over verse vis binnen de 12u, over diepvries binnen de 24u.');
    return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(num)+'</title><style>body{font-family:Arial,sans-serif;color:#111;margin:0;padding:34px;font-size:12px}.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:12px}h1{margin:0;font-size:20px}.meta{margin-top:3px;color:#444;line-height:1.45}.banner{margin-top:12px;padding:8px 10px;border:1px solid #c9a227;background:#fff8e8;color:#6a5200;font-size:11px}.parties{display:flex;gap:44px;margin-top:20px}.parties>div{flex:1}h2{font-size:10px;text-transform:uppercase;color:#555}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}th{font-size:10px;text-transform:uppercase;background:#f3f3f3}.num{text-align:right}.total{margin:18px 0 0 auto;width:250px}.total div{display:flex;justify-content:space-between;padding:4px 0}.grand{border-top:2px solid #111;margin-top:4px;padding-top:8px!important;font-size:14px;font-weight:bold}.bank{margin-top:18px;padding:10px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-size:11px;line-height:1.5}.foot{margin-top:25px;border-top:1px solid #ddd;padding-top:8px;font-size:10px;color:#555;line-height:1.55}</style></head><body><div class="head"><div><h1>'+esc(COMPANY.nom||"—" )+'</h1><div class="meta">'+companyBlock()+'</div></div><div style="text-align:right"><h1>'+title+'</h1><div class="meta">'+esc(num)+'<br>Bestelling: '+esc(order.ref)+(order.factuurnummer?'<br>Factuur: '+esc(order.factuurnummer):'')+'<br>Datum: '+esc(date(new Date().toISOString()))+'</div></div></div>'+(credit?'<div class="banner"><b>Voorbeeld — niet geboekt.</b> Creditnota (intern) zonder Airtable-nummer; niet automatisch verzonden.</div>':'')+'<div class="parties"><div><h2>Leverancier</h2>'+companyBlock()+'</div><div><h2>Klant</h2>'+esc(order.client)+'<br>'+esc((order.klant||{}).adresse||"").replace(/\n/g,"<br>")+'</div></div><table><tr><th>Beschrijving</th><th class="num">'+(priced?'Aantal':'Aantal')+'</th><th>Eenheid</th>'+(priced?'<th class="num">Tarief</th><th class="num">Subtotaal</th>':'')+'</tr>'+lineRows+'</table>'+(priced?'<div class="total"><div><span>Totaal excl. btw</span><span>'+eur(htva)+'</span></div><div><span>BTW 6,0%</span><span>'+eur(tva)+'</span></div><div class="grand"><span>Totaal</span><span>'+eur(total)+'</span></div></div>'+(invoice?bank:'')+'<div class="foot">'+foot+'</div>':'<div class="foot">'+foot+'</div>')+'</body></html>';
  }
  return{build,number,filename,parse,eur,esc,date,setCompany,getCompany:()=>COMPANY,canInvoice,invoiceBlockReason};
})();

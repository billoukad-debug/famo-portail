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
  // Taal van het document = taal van de klant (Clients.Taal : NL of FR). Standaard NL.
  const T={
    nl:{delivery:"LEVERINGSBON",invoice:"FACTUUR",credit:"CREDITNOTA",bank:"Bankgegevens",beneficiary:"Begunstigde",ref:"Mededeling",example:"Voorbeeld — nog niet definitief",
      paid:"Betaald",paidOn:"Betaald op",creditOn:"Creditnota op factuur",reason:"Reden",creditDate:"Creditnotadatum",invoiceDate:"Factuurdatum",dueDate:"Vervaldatum",deliveryDate:"Leverdatum",
      date:"Datum",document:"Document",order:"Bestelling",invoiceNo:"Factuur",customerNo:"Klantnummer",payStatus:"Betaalstatus",customer:"Klant",vat:"BTW",desc:"Beschrijving",qty:"Aantal",unit:"Eenheid",
      unitPrice:"Eenheidsprijs",subtotal:"Subtotaal",rateCol:"Btw-tarief",baseCol:"Maatstaf",vatCol:"Btw",amount:"Bedrag",totalEx:"Totaal excl. btw",vatLine:"btw",on:"op",totalInc:"Totaal incl. btw",noCompany:"Bedrijfsgegevens niet geladen",
      exampleBanner:"Voorbeeld bankgegevens.",exampleFix:"Vervang IBAN/BIC via Beheer vóór echte facturatie.",
      lot:"Lot",tht:"THT",thawed:"ontdooid",ordered:"besteld",methods:{"Gevangen op zee":"Gevangen op zee","Gevangen in zoet water":"Gevangen in zoet water","Gekweekt":"Gekweekt"},
      proforma:"PRO FORMA",retour:"RETOURBON",receivedBy:"Ontvangen door",signed:"ondertekend",terms:"Onze algemene verkoopsvoorwaarden zijn van toepassing (versie {v}) : {u}",companyNo:"Ondernemingsnummer",tradeName:"handelsnaam",units:{caisse:"kassa",carton:"doos","pièce":"stuk",piece:"stuk",kg:"kg"}},
    fr:{delivery:"BON DE LIVRAISON",invoice:"FACTURE",credit:"NOTE DE CRÉDIT",bank:"Coordonnées bancaires",beneficiary:"Bénéficiaire",ref:"Communication",example:"Exemple — pas encore définitif",
      paid:"Payée",paidOn:"Payée le",creditOn:"Note de crédit sur la facture",reason:"Motif",creditDate:"Date de la note de crédit",invoiceDate:"Date de facture",dueDate:"Échéance",deliveryDate:"Date de livraison",
      date:"Date",document:"Document",order:"Commande",invoiceNo:"Facture",customerNo:"N° client",payStatus:"Statut de paiement",customer:"Client",vat:"TVA",desc:"Description",qty:"Quantité",unit:"Unité",
      unitPrice:"Prix unitaire",subtotal:"Sous-total",rateCol:"Taux TVA",baseCol:"Base",vatCol:"TVA",amount:"Montant",totalEx:"Total HTVA",vatLine:"TVA",on:"sur",totalInc:"Total TVAC",noCompany:"Coordonnées de l'entreprise non chargées",
      exampleBanner:"Coordonnées bancaires d'exemple.",exampleFix:"Remplacez l'IBAN/BIC dans Beheer avant de facturer.",
      lot:"Lot",tht:"DLC",thawed:"décongelé",ordered:"commandé",methods:{"Gevangen op zee":"Pêché en mer","Gevangen in zoet water":"Pêché en eaux douces","Gekweekt":"Élevé"},
      proforma:"PRO FORMA",retour:"BON DE RETOUR",receivedBy:"Réceptionné par",signed:"signé",terms:"Nos conditions générales de vente s'appliquent (version {v}) : {u}",companyNo:"N° d'entreprise",tradeName:"nom commercial",units:{caisse:"caisse",carton:"carton","pièce":"pièce",piece:"pièce",kg:"kg"}}
  };
  const langOf=order=>{const v=String((order&&(order.taal||(order.klant&&order.klant.taal)))||"").trim().toLowerCase();return v==="fr"?"fr":"nl";};
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
    exampleBank:false,
    facturatie:"boekhouder",
    legal:{}
  };
  // Mode de facturation (lib/billing.js) : « boekhouder » = la facture légale vient du comptable
  // (Billtobox, Peppol) ; les documents du portail sont des pro forma / bons de retour.
  const accountant=()=>COMPANY.facturatie!=="portaal";
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
    base.facturatie=String(cfg&&cfg.facturatie||"").toLowerCase()==="portaal"?"portaal":"boekhouder";
    base.legal=cfg&&cfg.legal&&typeof cfg.legal==="object"?cfg.legal:{};
    base.voorwaardenVersie=String(cfg&&cfg.voorwaardenVersie||"").trim(); // C-12 : CGV publiées
    COMPANY=window.famoCompany?famoCompany.withExampleBank(base):Object.assign({exampleBank:false},base);
    return COMPANY;
  }
  // IBAN et nom obligatoires ; le BIC est facultatif (virement SEPA belge) et n'apparaît que s'il existe.
  function canInvoice(){
    if(accountant()) return !!COMPANY.nom;
    return !!(COMPANY.iban && COMPANY.nom && !COMPANY.exampleBank);
  }
  function invoiceBlockReason(){
    if(!COMPANY.nom) return "Bedrijfsgegevens ontbreken. Vul ze in via Beheer.";
    if(!accountant()&&(!COMPANY.iban||COMPANY.exampleBank)) return "Factuur geblokkeerd: IBAN ontbreekt. Vul het in via Beheer.";
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
    if(type==="invoice") return accountant()?(order.factuurnummer?"PF-"+String(order.factuurnummer).replace(/^FA-/i,""):"—"):(order.factuurnummer||"—");
    if(type==="credit"&&accountant()) return "RB-"+String((order.creditnota&&order.creditnota.nummer)||order.factuurnummer||order.ref||"").replace(/^(CN|FA|CMD)-/i,"");
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
    if(type==="invoice") return (accountant()?"Famo-ProForma-":"Famo-Factuur-")+safe(accountant()?number(order,"invoice"):(order.factuurnummer||order.ref||"FA"))+".pdf";
    if(type==="credit") return (accountant()?"Famo-Retour-":"Famo-Creditnota-")+safe(number(order,"credit"))+".pdf";
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
    const pct=Number.isFinite(Number(COMPANY.btwTarief))&&Number(COMPANY.btwTarief)>=0?Number(COMPANY.btwTarief):6;
    const map=priced?(order.btwFrozen&&typeof order.btwFrozen==="object"?order.btwFrozen:rateMap(order)):null;
    // Régime de TVA du client (C-10, assets/vat.js) : figé sur la facture par le serveur (order.btwRegime).
    // Intracommunautaire / export / cocontractant : 0 % sur chaque ligne + mention légale sous les totaux.
    const reg=priced&&window.FamoVat&&window.FamoVat.regime?window.FamoVat.regime(order.btwRegime):{zero:false};
    const baseTotal=credit?(cn.montant==null?order.total:cn.montant):order.total;
    // Règle unique (assets/vat.js) : ligne arrondie au cent, base et TVA par taux. Sans prix de ligne
    // (anciennes commandes), un seul groupe au taux de l'entreprise sur le total stocké.
    let htva, groups, tva, total;
    const linePriced=!!(rows.some(r=>r.price!=null)&&window.FamoVat);
    if(linePriced){
      const t=window.FamoVat.totals(rows,name=>reg.zero?0:rateFor(name,map,pct),sign);
      htva=t.htva; groups=t.groups; tva=t.tva; total=t.total;
    }else{
      htva=cents(Number(baseTotal||0)*sign);
      const p0=reg.zero?0:pct;
      groups=[{rate:p0,base:htva,tva:Math.round(htva*p0)/100}];
      tva=cents(groups[0].tva); total=cents(htva+tva);
    }
    const num=number(order,type);
    const lang=langOf(order), L=T[lang];
    const regimeTxt=reg.zero?(reg[lang]||reg.nl||""):"";
    const pro=accountant();
    const title=credit?(pro?L.retour:L.credit):(invoice?(pro?L.proforma:L.invoice):L.delivery);
    // Rendu uniquement à partir d'ici — parse/calculs inchangés (parité M6).
    const nlUnit=value=>L.units[String(value||"").toLowerCase()]||((lang==="nl"&&typeof window!=="undefined"&&window.famoNL)?famoNL.unit(value):value);
    const ibanFmt=value=>String(value||"").replace(/\s+/g,"").replace(/(.{4})/g,"$1 ").trim();
    const ogm=invoice&&!pro?structuredRef(order.factuurnummer):"";
    // Traçabilité (règl. UE 1379/2013 art. 35) : lot(s) livré(s) par article, instantané de la préparation.
    const lotsOf=name=>{const m=order.lots&&typeof order.lots==="object"?order.lots:null;if(!m)return[];const k=Object.keys(m).find(x=>String(x).trim().toLowerCase()===String(name||"").trim().toLowerCase());return k?(m[k]||[]):[];};
    const lotTxt=l=>[L.lot+" "+esc(l.lotnummer),l.wetenschappelijkeNaam?"<i>"+esc(l.wetenschappelijkeNaam)+"</i>":"",esc(l.vangstgebied),esc(L.methods[l.productiemethode]||l.productiemethode),esc(l.vistuig),l.ontdooid?L.thawed:"",l.tht?L.tht+" "+date(l.tht):""].filter(Boolean).join(" · ");
    // Poids réel (audit H-04) : quantité commandée à la création, montrée si la livraison diffère.
    const ordered=(!credit&&order.besteld)?parse(order.besteld):[];
    const orderedOf=name=>{const k=String(name||"").trim().toLowerCase();const o=ordered.find(x=>String(x.name||"").trim().toLowerCase()===k);return o?o.qty:null;};
    const diffTxt=row=>{const o=orderedOf(row.name);if(o==null)return"";const a=Number(String(o).replace(",",".")),b=Number(String(row.qty).replace(",","."));return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)>1e-9?'<small class="ordered">'+L.ordered+" "+esc(qtyTxt(o))+" "+esc(nlUnit(row.unit))+'</small>':"";};
    // Conditionnement (spec 023) : figé à la commande (order.verpakking, par nom de ligne) ; la ligne reste en unités.
    // « 2 doos × 6 st = 12 st » (+ « × € 1,00 = € 12,00 » sur un document chiffré), même règle que le serveur (assets/vat.js).
    const pakIn=name=>{const m=order.verpakking&&typeof order.verpakking==="object"?order.verpakking:null;const V=typeof window!=="undefined"?window.FamoVat:null;if(!m||!V||!V.pakOf)return null;const k=String(name||"").trim().toLowerCase();return Object.prototype.hasOwnProperty.call(m,k)?V.pakOf(m[k]):null;};
    const pakTxt=(row,qty,unitPrice)=>{const p=pakIn(row.name);if(!p)return"";const t=window.FamoVat.pakCalc(qty,row.unit,p,lang,priced?unitPrice:null,eur);return t?'<small class="pak">'+esc(t)+'</small>':"";};
    // Taux de TVA de chaque ligne (EN 16931, constitution V) : même règle que les totaux ci-dessus.
    const fmtRate=r=>esc(String(r).replace(".",","))+"%";
    const lineRate=name=>linePriced?(reg.zero?0:rateFor(name,map,pct)):groups[0].rate;
    const lineRows=rows.map(row=>{
      const qty=Number(String(row.qty).replace(",","."))||0;
      const unitPrice=row.price==null?null:row.price*sign;
      const sub=unitPrice==null?null:(window.FamoVat?window.FamoVat.r2(unitPrice*qty):unitPrice*qty);
      return '<tr><td class="desc"><span class="item">'+esc(row.name)+'</span>'+(row.comment?'<small>'+esc(row.comment)+'</small>':'')+pakTxt(row,qty,unitPrice)+lotsOf(row.name).map(l=>'<small class="lot">'+lotTxt(l)+'</small>').join("")+'</td><td class="num">'+esc(qtyTxt(row.qty))+diffTxt(row)+'</td><td>'+esc(nlUnit(row.unit))+'</td>'+(priced?'<td class="num">'+(unitPrice==null?'—':eur(unitPrice))+'</td><td class="num rate">'+fmtRate(lineRate(row.name))+'</td><td class="num">'+(sub==null?'—':eur(sub))+'</td>':'')+'</tr>';
    }).join("");
    // Betaalstatus enkel wanneer betaald (met datum indien gekend).
    const paid=String(order.paiement||"")==="Payé"||/^(betaald|payé)$/i.test(String(order.paiement||""));
    const paidTxt=paid?(order.payeLe?L.paidOn+" "+date(order.payeLe):L.paid):"";
    const terms=COMPANY.betalingsvoorwaarden?esc(COMPANY.betalingsvoorwaarden):"";
    const foot=credit
      ? (pro?L.order+' '+esc(order.ref||"—"):L.creditOn+' '+esc(order.factuurnummer||"—"))+'.'+(cn.motif?' '+L.reason+': '+esc(cn.motif)+'.':'')+(terms?' '+terms:'')
      : (invoice
        ? terms
        : esc(COMPANY.leveringsvoorwaarden||"").replace(/\n/g,'<br>'));
    // Mode boekhouder : plus de bandeau « geen factuur » (retiré le 2026-10-08, demande du co-gérant) ; le titre
    // PRO FORMA / RETOURBON et le numéro PF distinguent le document de la facture légale (Peppol, comptable).
    const banners=(invoice&&!pro&&COMPANY.exampleBank?'<div class="banner"><b>'+L.exampleBanner+'</b> '+(lang==="nl"&&window.famoCompany?esc(famoCompany.EXAMPLE.label):L.exampleFix)+'</div>':'');
    // Marque F sobre (assets/brand/famo-mark.svg) : carré Noordzee, F blanc en tracés.
    const mark='<svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0B5A6C"/><path d="M11 8h11v3.4h-7.2v3.3h6.2v3.4h-6.2V24H11z" fill="#FFFFFF"/></svg>';
    const coords=[COMPANY.adresse,COMPANY.cp,COMPANY.tva?L.vat+" "+COMPANY.tva:"",COMPANY.tel].filter(Boolean).map(esc).join("<br>");
    const lg=COMPANY.legal||{};
    const termsUrl=(typeof location!=="undefined"&&/^https?:/.test(location.protocol)?location.origin:"")+"/voorwaarden";
    const termsLine=COMPANY.voorwaardenVersie?esc(L.terms.replace("{v}",COMPANY.voorwaardenVersie).replace("{u}",termsUrl)):"";
    const legalLine=[lg.naam?(lg.naam+(lg.rechtsvorm&&!String(lg.naam).toLowerCase().split(/[^a-z0-9.]+/).includes(String(lg.rechtsvorm).toLowerCase())?" "+lg.rechtsvorm:"")):"",lg.ondernemingsnummer?L.companyNo+" "+lg.ondernemingsnummer:"",lg.rpr||"",lg.naam&&lg.handelsnaam&&lg.handelsnaam!==lg.naam?L.tradeName+" "+lg.handelsnaam:""].filter(Boolean).map(esc).join(" · ");
    // En-tête : à gauche qui envoie, à droite quel document.
    const mast='<header class="mast"><div class="supplier">'+mark+'<div><div class="wordmark">'+esc(COMPANY.nom||"—")+'</div><div class="coords">'+(coords||'<em>'+L.noCompany+'</em>')+'</div></div></div>'+
      '<div class="doctype"><h1>'+title+'</h1></div></header>';
    const klant=order.klant||{};
    const metaCell=(label,value,mono)=>value?'<div><div class="metalabel">'+label+'</div><div class="metavalue'+(mono?' mono':'')+'">'+esc(value)+'</div></div>':'';
    // Datums : factuur = Facturée le (anders vandaag) + vervaldatum ; creditnota = datum creditnota ;
    // leveringsbon = Livrée le (anders vandaag).
    const factuurdatum=invoice?(order.factureeLe||todayIso()):"";
    const vervaldatum=invoice?addDays(factuurdatum,COMPANY.betaaltermijnDagen):"";
    const leverdatum=invoice?(order.livreeLe||order.dateLiv||""):(order.dateLiv||"");
    const dates=credit
      ? metaCell(L.creditDate,date(cn.le||todayIso()))
      : (invoice
        ? (pro?metaCell(L.date,date(factuurdatum)):metaCell(L.invoiceDate,date(factuurdatum))+metaCell(L.dueDate,date(vervaldatum)))+(leverdatum?metaCell(L.deliveryDate,date(leverdatum)):"")
        : metaCell(L.date,date(order.livreeLe||todayIso()))+(leverdatum?metaCell(L.deliveryDate,date(leverdatum)):""));
    const metaband='<div class="metaband">'+
      metaCell(L.document,num,true)+
      metaCell(L.order,order.ref,true)+
      (!invoice&&!pro&&order.factuurnummer?metaCell(L.invoiceNo,order.factuurnummer,true):"")+
      dates+
      (klant.klantnr?metaCell(L.customerNo,klant.klantnr,true):"")+
      // Bon de livraison : qui a réceptionné, et s'il a signé sur place (H-09).
      (!priced&&order.receptionnePar?metaCell(L.receivedBy,order.receptionnePar+((order.preuveLivraison||[]).some(a=>/^handtekening-/.test(a&&a.filename||""))||order.getekend?" · "+L.signed:"")):"")+
      (invoice&&!pro&&paidTxt?metaCell(L.payStatus,paidTxt):"")+
      '</div>';
    // Deuxième rangée : à gauche à qui (bloc adresse), à droite les faits du document.
    const klantBlock='<section class="party"><h2>'+L.customer+'</h2><div class="partyname">'+esc(order.client)+'</div>'+
      (klant.adresse?'<div class="partymeta">'+esc(klant.adresse).replace(/\n/g,"<br>")+'</div>':'')+
      (klant.btw?'<div class="partymeta">'+L.vat+' '+esc(klant.btw)+'</div>':'')+
      '</section>';
    const head='<div class="head">'+klantBlock+metaband+'</div>';
    const table='<table class="lines"><thead><tr><th>'+L.desc+'</th><th class="num">'+L.qty+'</th><th>'+L.unit+'</th>'+
      (priced?'<th class="num">'+L.unitPrice+'</th><th class="num">'+L.vat+'</th><th class="num">'+L.subtotal+'</th>':'')+
      '</tr></thead><tbody>'+lineRows+'</tbody></table>';
    // Récapitulatif TVA par taux (base, TVA) à gauche, totaux à droite.
    const vatsum='<table class="vatsum"><thead><tr><th>'+L.rateCol+'</th><th class="num">'+L.baseCol+'</th><th class="num">'+L.vatCol+'</th></tr></thead><tbody>'+
      groups.map(g=>'<tr><td>'+fmtRate(g.rate)+'</td><td class="num">'+eur(g.base)+'</td><td class="num">'+eur(g.tva)+'</td></tr>').join("")+
      '</tbody></table>';
    const totals='<section class="sum">'+vatsum+'<div class="totals">'+
      '<div class="trow"><span>'+L.totalEx+'</span><span>'+eur(htva)+'</span></div>'+
      groups.map(g=>'<div class="trow"><span>'+L.vatLine+' '+esc(String(g.rate).replace(".",","))+'%'+(groups.length>1?' <small>('+L.on+' '+esc(eur(g.base))+')</small>':'')+'</span><span>'+eur(g.tva)+'</span></div>').join("")+
      '<div class="trow grand"><span>'+L.totalInc+'</span><span>'+eur(total)+'</span></div>'+
      '</div></section>'+(regimeTxt?'<div class="regime">'+esc(regimeTxt)+'</div>':'');
    // Paiement (facture du portail) : montant, échéance, puis où et avec quelle communication.
    const bank='<section class="bank"><div class="banklabel">'+L.bank+'</div>'+
      '<div class="bankrow"><span>'+L.amount+'</span><b class="mono">'+eur(total)+'</b></div>'+
      '<div class="bankrow"><span>'+L.dueDate+'</span><b>'+date(vervaldatum)+'</b></div>'+
      '<div class="bankrow"><span>'+L.beneficiary+'</span><b>'+esc(COMPANY.nom)+'</b></div>'+
      '<div class="bankrow"><span>IBAN</span><b class="mono">'+esc(ibanFmt(COMPANY.iban))+'</b></div>'+
      (COMPANY.bic?'<div class="bankrow"><span>BIC</span><b class="mono">'+esc(COMPANY.bic)+'</b></div>':'')+
      (ogm?'<div class="bankrow"><span>'+L.ref+'</span><b class="mono">'+esc(ogm)+'</b></div>':'')+
      (COMPANY.exampleBank?'<div class="bankexample"><em>'+L.example+'</em></div>':'')+
      '</section>';
    const ink="#0E2229",muted="#475A61",line="#D3DDDF",soft="#E3EAEB",ijs="#EFF3F3";
    const css='@page{size:A4;margin:14mm 16mm 16mm}'+
      '*{box-sizing:border-box}'+
      'html{background:#FFFFFF}'+
      'body{margin:0;padding:40px 60px 12px;background:#FFFFFF;color:'+ink+';font-family:Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.45;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
      'h1,h2{margin:0}em{font-style:italic}b{font-weight:700}'+
      '.mast{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}'+
      '.supplier{display:flex;align-items:flex-start;gap:12px}'+
      '.supplier svg{display:block;flex:none}'+
      '.wordmark{font-size:15px;font-weight:700;line-height:1.2}'+
      '.coords{margin-top:4px;font-size:10px;line-height:1.5;color:'+muted+'}'+
      '.doctype{text-align:right}'+
      'h1{font-size:22px;font-weight:700;line-height:1.15;letter-spacing:.04em}'+
      '.head{display:flex;justify-content:space-between;align-items:flex-start;gap:32px;margin-top:26px;padding-top:16px;border-top:1px solid '+ink+'}'+
      '.party{flex:1;min-width:0}'+
      'h2,.banklabel{margin:0 0 5px;font-size:10px;font-weight:700;color:'+muted+'}'+
      '.partyname{font-size:13px;font-weight:700;line-height:1.3}'+
      '.partymeta{margin-top:3px;font-size:11px;line-height:1.5}'+
      '.metaband{flex:none;width:310px}'+
      '.metaband>div{display:flex;gap:12px}'+
      '.metalabel{flex:none;width:128px;font-size:10.5px;line-height:18px;color:'+muted+'}'+
      '.metavalue{min-width:0;font-size:11.5px;line-height:18px}'+
      '.metaband>div:first-child .metavalue{font-weight:700}'+
      '.mono{font-variant-numeric:tabular-nums;letter-spacing:.01em}'+
      '.banner{margin-top:18px;padding:9px 12px;background:'+ijs+';border:1px solid '+line+';border-radius:6px;font-size:11px;line-height:1.5}'+
      'table{width:100%;border-collapse:collapse}'+
      '.lines{margin-top:26px}'+
      '.lines th{padding:0 8px 6px;border-bottom:1px solid '+ink+';text-align:left;vertical-align:bottom;font-size:10px;font-weight:700;color:'+muted+'}'+
      '.lines td{padding:8px;border-bottom:1px solid '+soft+';text-align:left;vertical-align:top}'+
      '.lines th:first-child,.lines td:first-child{padding-left:0}'+
      '.lines th:last-child,.lines td:last-child{padding-right:0}'+
      '.item{font-weight:700}'+
      'td small{display:block;margin-top:2px;font-size:10px;line-height:1.4;color:'+muted+'}'+
      'td small.pak{color:'+ink+';font-weight:600}'+
      '.num{text-align:right;white-space:nowrap}'+
      '.lines .num{text-align:right}'+
      '.rate{color:'+muted+'}'+
      '.sum{display:flex;justify-content:space-between;align-items:flex-start;gap:32px;margin-top:18px}'+
      '.vatsum{width:250px}'+
      '.vatsum th{padding:0 0 4px;border-bottom:1px solid '+line+';text-align:left;font-size:10px;font-weight:700;color:'+muted+'}'+
      '.vatsum td{padding:4px 0;border-bottom:1px solid '+soft+';font-size:10.5px}'+
      '.vatsum .num{padding-left:12px;text-align:right}'+
      '.totals{flex:none;width:270px}'+
      '.trow{display:flex;justify-content:space-between;gap:16px;padding:3px 0}'+
      '.trow span:first-child{color:'+muted+'}'+
      '.trow small{font-size:10px;color:'+muted+'}'+
      '.grand{margin-top:6px;padding-top:8px;border-top:1.5px solid '+ink+';font-size:15px;font-weight:700}'+
      '.grand span:first-child{color:'+ink+'}'+
      '.regime{margin-top:16px;padding:9px 12px;background:'+ijs+';border-radius:6px;font-size:10.5px;font-weight:700;line-height:1.5}'+
      '.bank{margin-top:20px;padding:12px 16px;background:'+ijs+';border-radius:10px}'+
      '.bankrow{display:flex;gap:12px;padding:1px 0}'+
      '.bankrow span{flex:none;width:128px;color:'+muted+'}'+
      '.bankexample{margin-top:6px;color:#7A5410}'+
      '.foot{margin-top:24px;font-size:10px;line-height:1.55}'+
      '.legal{margin-top:14px;padding-top:8px;border-top:1px solid '+line+';font-size:9px;line-height:1.5;color:'+muted+'}'+
      '.doc+.doc{margin-top:48px}'+
      'thead{display:table-header-group}'+
      'tr{break-inside:avoid;page-break-inside:avoid}'+
      '.mast,.head,.banner,.sum,.regime,.bank,.foot,.legal{break-inside:avoid;page-break-inside:avoid}'+
      '.mast,.head{break-after:avoid;page-break-after:avoid}'+
      '@media print{body{padding:0}.doc+.doc{margin-top:0}}';
    const legal=legalLine?'<div class="legal">'+legalLine+'</div>':'';
    const body=mast+head+banners+table+
      (priced?totals+(invoice&&!pro?bank:''):'')+
      (foot||termsLine?'<div class="foot">'+[foot,termsLine].filter(Boolean).join('<br>')+'</div>':'')+
      legal;
    return{num,title,css,body,lang};
  }
  const wrap=(titleTxt,css,inner,lang)=>'<!doctype html><html lang="'+(lang||"nl")+'"><head><meta charset="utf-8"><title>'+esc(titleTxt)+'</title><style>'+css+'</style></head><body>'+inner+'</body></html>';
  function build(order,type){
    const r=render(order,type);
    return wrap(r.num,r.css,r.body,r.lang);
  }
  // Meerdere documenten in één HTML (één <style>), elk op een eigen pagina.
  function buildMany(orders,type){
    const list=(orders||[]).map(o=>render(o,type));
    if(!list.length) throw new Error("Geen documenten om te bundelen.");
    const inner=list.map((r,i)=>'<div class="doc">'+r.body+'</div>'+(i<list.length-1?'<div style="page-break-after:always"></div>':'')).join("");
    return wrap(list.length===1?list[0].num:list[0].title+" ("+list.length+")",list[0].css,inner,list.every(r=>r.lang===list[0].lang)?list[0].lang:"nl");
  }
  return{build,buildMany,langOf,number,structuredRef,filename,filenameMany,parse,eur,esc,date,setCompany,getCompany:()=>COMPANY,canInvoice,invoiceBlockReason,usingExampleBank};
})();

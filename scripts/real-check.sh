#!/bin/bash
# Echte ketentest tegen een beschermde Vercel-preview (met echte Airtable/Resend).
# Gebruik: SHARE_URL="https://…?_vercel_share=…" ADMIN_CODE="…" TEST_EMAIL="…" bash scripts/real-check.sh
set -u
BASE=$(echo "$SHARE_URL" | sed -E 's#(https://[^/?]+).*#\1#')
JAR=$(mktemp)
H=(-H "Content-Type: application/json" -H "X-Requested-With: famo-kade")
step() { printf '\n== %s\n' "$1"; }
call() { # method path [json]
  local m=$1 p=$2 d=${3:-}
  if [ -n "$d" ]; then curl -s -b "$JAR" -c "$JAR" -X "$m" "$BASE$p" "${H[@]}" -d "$d"; else curl -s -b "$JAR" -c "$JAR" -X "$m" "$BASE$p" "${H[@]}"; fi
}
j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const f=process.argv[1];console.log(f?eval("(o)=>"+f)(o):JSON.stringify(o).slice(0,400))}catch(e){console.log("RAW:",s.slice(0,300))}})' "$1"; }

step "Toegang tot de beschermde preview"
curl -s -L -o /dev/null -c "$JAR" -b "$JAR" -w "share link -> %{http_code}\n" "$SHARE_URL"
step "Status"
call GET /api/status | j 'JSON.stringify({configured:o.configured,missing:o.missing,optionalMissing:o.optionalMissing,mail:o.mail,airtable:o.airtable})'
step "Publieke config"
call GET /api/publiek/config | j 'JSON.stringify({company:o.company&&o.company.companyName,cutoff:o.cutoff,days:o.deliveryDays})'

step "Team login (admin)"
call POST /api/team/login "{\"code\":\"$ADMIN_CODE\"}" | j 'JSON.stringify(o)'
step "Team overzicht (echte open bestellingen)"
call GET /api/team/overzicht | j 'JSON.stringify({today:o.today,orders:o.orders.map(x=>({ref:x.ref,status:x.status,client:x.client&&x.client.name,lines:x.lines.length,total:x.totalCents}))})'
step "Beheer overzicht"
call GET /api/beheer/overzicht | j 'JSON.stringify({clients:o.clients.length,products:o.products.length,prices:o.prices.length,requests:o.requests.length,invoices:o.invoices.length,warnings:o.warnings.map(w=>w.key),config:{cutoff:o.config.cutoff,days:o.config.deliveryDays,ops:o.config.opsEmail,iban:!!o.config.iban},env:o.env})'

step "Testklant aanmaken"
CL=$(call POST /api/beheer/klanten "{\"naam\":\"ZZ Kade-test (verwijderen)\",\"email\":\"$TEST_EMAIL\",\"telefoon\":\"+32 400 00 00 00\",\"adres\":\"Testkaai 1\\n2000 Antwerpen\",\"btw\":\"BE0999999999\",\"gebruikersnaam\":\"kadetest\",\"notities\":\"Aangemaakt door de ketentest van Famo Kade.\",\"force\":true}")
echo "$CL" | j 'JSON.stringify({ok:o.ok,id:o.client&&o.client.id,user:o.client&&o.client.username,number:o.client&&o.client.number,pw:!!o.password,error:o.error})'
CLIENT_ID=$(echo "$CL" | j 'o.client&&o.client.id')
PASSWORD=$(echo "$CL" | j 'o.password')
echo "$CLIENT_ID" > "$JAR.client"

step "Klantprijs instellen"
PRODUCT_ID=$(call GET /api/beheer/overzicht | j 'o.products.filter(p=>p.active)[0].id')
call POST /api/beheer/prijzen "{\"klantId\":\"$CLIENT_ID\",\"productId\":\"$PRODUCT_ID\",\"prijs\":\"9,99\"}" | j 'JSON.stringify({ok:o.ok,n:o.prices&&o.prices.length})'

step "Klant login"
KJAR=$(mktemp); cp "$JAR" "$KJAR"
kcall() { local m=$1 p=$2 d=${3:-}; if [ -n "$d" ]; then curl -s -b "$KJAR" -c "$KJAR" -X "$m" "$BASE$p" "${H[@]}" -d "$d"; else curl -s -b "$KJAR" -c "$KJAR" -X "$m" "$BASE$p" "${H[@]}"; fi; }
ME=$(kcall POST /api/klant/login "{\"login\":\"kadetest\",\"wachtwoord\":\"$PASSWORD\"}")
echo "$ME" | j 'JSON.stringify({client:o.client&&o.client.name,catalogue:o.catalogue&&o.catalogue.length,neg:o.catalogue&&o.catalogue.filter(p=>p.negotiated).map(p=>p.name+"="+p.priceCents),dates:o.deliveryDates&&o.deliveryDates.slice(0,2).map(d=>d.iso),error:o.error})'
DATE=$(echo "$ME" | j 'o.deliveryDates[0].iso')
P2=$(echo "$ME" | j 'o.catalogue.filter(p=>p.id!=="'"$PRODUCT_ID"'")[0].id')

step "Bestelling plaatsen (klant) — e-mails naar team en klant"
ORD=$(kcall POST /api/klant/bestellen "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":2,\"comment\":\"ketentest\"},{\"productId\":\"$P2\",\"qty\":1}],\"leverdatum\":\"$DATE\",\"opmerking\":\"Automatische ketentest Famo Kade — mag genegeerd worden.\"}")
echo "$ORD" | j 'JSON.stringify({ok:o.ok,ref:o.order&&o.order.ref,id:o.order&&o.order.id,total:o.order&&o.order.totalCents,lines:o.order&&o.order.lines.map(l=>l.name+" x"+l.qty+" @"+l.priceCents),mail:o.mail,error:o.error})'
ORDER_ID=$(echo "$ORD" | j 'o.order&&o.order.id')
echo "$ORDER_ID" > "$JAR.order"

step "Team: lijn aanpassen, klaar, onderweg (e-mail klant)"
call POST "/api/team/bestellingen/$ORDER_ID/lijnen" "{\"lijnen\":[{\"name\":\"$(echo "$ORD" | j 'o.order.lines[0].name')\",\"qty\":3,\"unit\":\"$(echo "$ORD" | j 'o.order.lines[0].unit')\",\"priceCents\":$(echo "$ORD" | j 'o.order.lines[0].priceCents'),\"comment\":\"ketentest aangepast\"},{\"name\":\"$(echo "$ORD" | j 'o.order.lines[1].name')\",\"qty\":1,\"unit\":\"$(echo "$ORD" | j 'o.order.lines[1].unit')\",\"priceCents\":$(echo "$ORD" | j 'o.order.lines[1].priceCents')}]}" | j 'JSON.stringify({ok:o.ok,total:o.order&&o.order.totalCents,error:o.error})'
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
call POST "/api/team/bestellingen/$ORDER_ID/klaar" "{\"foto\":\"$PNG\"}" | j 'JSON.stringify({ok:o.ok,status:o.order&&o.order.status,photo:o.order&&o.order.prepPhoto.length,warnings:o.warnings,error:o.error})'
call POST "/api/team/bestellingen/$ORDER_ID/onderweg" "{}" | j 'JSON.stringify({ok:o.ok,status:o.order&&o.order.status,mail:o.mail,error:o.error})'

step "Team: levering afronden met handtekening — factuurnummer + e-mails"
call POST "/api/team/bestellingen/$ORDER_ID/geleverd" "{\"ontvanger\":\"Ketentest\",\"handtekening\":\"$PNG\"}" | j 'JSON.stringify({ok:o.ok,status:o.order&&o.order.status,invoice:o.invoiceNumber,proof:o.order&&o.order.proof.length,mail:o.mail,warnings:o.warnings,error:o.error})'
call POST "/api/team/bestellingen/$ORDER_ID/betaald" "{\"betaald\":true}" | j 'JSON.stringify({ok:o.ok,paid:o.order&&o.order.paid})'

step "Documenten"
curl -s -b "$JAR" -o /dev/null -w "leveringsbon (team) -> %{http_code}\n" "$BASE/doc/leveringsbon/$ORDER_ID"
curl -s -b "$JAR" -o /tmp/factuur.html -w "factuur (team) -> %{http_code}\n" "$BASE/doc/factuur/$ORDER_ID"; grep -o "FA-2026-[0-9]*" /tmp/factuur.html | head -1; grep -c "Totaal incl. btw" /tmp/factuur.html
curl -s -b "$KJAR" -o /dev/null -w "factuur (klant) -> %{http_code}\n" "$BASE/doc/factuur/$ORDER_ID"
curl -s -o /dev/null -w "factuur (anoniem, verwacht 403 of SSO) -> %{http_code}\n" "$BASE/doc/factuur/$ORDER_ID"
curl -s -b "$JAR" -o /dev/null -w "picklijst -> %{http_code}\n" "$BASE/doc/picklijst?dag=$DATE"

step "Klant ziet bestelling + factuurlink"
kcall GET /api/klant/bestellingen | j 'JSON.stringify(o.orders.filter(x=>x.id==="'"$ORDER_ID"'").map(x=>({ref:x.ref,status:x.status,invoice:x.invoiceNumber,paid:x.paid,docs:!!x.docs.invoice})))'

step "Systeemcontrole (maakt en verwijdert eigen testdata)"
call POST /api/beheer/systeemcontrole "{}" | j 'JSON.stringify({ok:o.ok,steps:o.steps.map(s=>(s.ok?"OK ":"FOUT ")+s.label+(s.detail?" — "+s.detail:""))},null,1)'

step "Publieke aanvraag"
call POST /api/publiek/aanvraag "{\"bedrijfsnaam\":\"ZZ Kade-test aanvraag (verwijderen)\",\"contactpersoon\":\"Ketentest\",\"email\":\"$TEST_EMAIL\",\"telefoon\":\"+32 400 00 00 00\",\"adres\":\"Testkaai 1\",\"bericht\":\"Automatische ketentest — negeren.\"}" | j 'JSON.stringify(o)'

echo; echo "CLIENT_ID=$CLIENT_ID ORDER_ID=$ORDER_ID"
rm -f "$JAR" "$KJAR"

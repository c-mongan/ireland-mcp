const U="https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp";
const H={"content-type":"application/json",accept:"application/json, text/event-stream"};
let id=0; const rpc=async(method,params)=>{const r=await fetch(U,{method:"POST",headers:H,body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params})});const t=await r.text();const m=t.match(/^data: (.*)$/m);return JSON.parse(m?m[1]:t);};
const call=async(source,operation,args)=>{const t0=Date.now();const r=await rpc("tools/call",{name:"ireland_call",arguments:{source,operation,arguments:args}});return {ms:Date.now()-t0,body:JSON.parse(r.result.content[0].text)};};
const out=[];const log=(k,v)=>{out.push(`## ${k}\n\n\`\`\`json\n${JSON.stringify(v,null,1).slice(0,1500)}\n\`\`\`\n`);console.log(k, JSON.stringify(v).slice(0,300));};
const ops=await call("oireachtas","oireachtas_search_members",{constituency:"Galway West"}).catch(e=>({err:String(e)}));
log("H1 Galway West current TDs",{ms:ops.ms,names:(ops.body?.data?.members??ops.body?.data?.results??[]).map(m=>m.name??m.full_name),connolly:JSON.stringify(ops.body).includes("Connolly"),note:ops.body?.data?.note, err:ops.body?.error});
const b=[];let off=0,rows=0,salt=null,pages=0;for(;;){const r=await call("epa","epa_bathing_locations",{offset:off,limit:50});pages++;const d=r.body.data;const items=d.locations??d.results??d.items??[];rows+=items.length;salt??=items.find(x=>/salthill/i.test(x.beach_name??x.name??""));if(r.body.next_offset==null&&d.next_offset==null)break;off=r.body.next_offset??d.next_offset;if(pages>10)break;}
log("H2 EPA bathing paging",{pages,rows,salthill:salt});
const bad=[];for(let i=0;i<6;i++){bad.push((await call("ncse","ncse_search_datasets",{rows:-5,query:"x"})).body.error?.code);} const good=await call("ncse","ncse_search_datasets",{query:"allocation"});
log("H3 breaker after 6 bad NCSE calls",{bad,good_ok:!good.body.error,good_err:good.body.error});
for(const q of ["Kilkee","Westport"]){const t0=Date.now();const r=await rpc("tools/call",{name:"search",arguments:{query:q}});log(`H4 search ${q}`,{ms:Date.now()-t0,results:JSON.parse(r.result.content[0].text).results?.slice(0,3).map(x=>x.title)});}
const e=await call("met-eireann","met_get_forecast",{latitude:999,longitude:0});log("M6 4xx/BAD_ARGS message",e.body.error??e.body);
(await import("node:fs")).writeFileSync("docs/demo/qa-r2/hosted-checks.md",`# Hosted QA round-2 checks (${new Date().toISOString()})\n\nEndpoint: ${U} (v1.1.1)\n\n`+out.join("\n"));

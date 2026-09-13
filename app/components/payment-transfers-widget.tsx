"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { readJson } from "../lib/http";
import { formatLogDate, formatMoney } from "../lib/student-activity";
import StudentPanel from "./student-panel";
type Filter={id:number;collectorName:string|null;collectorEmail:string;fromDate:string|null;toDate:string|null;paymentTypes:string;totalMinor:number;paymentCount:number;allGiven:number};type Payment={purpose:"course"|"practice_donation";receivedMethod:string;practiceDescription:string|null;id:number;studentId:number;firstName:string;lastName:string;studentEmail:string|null;studentPicture:string|null;paidOn:string;amountMinor:number;givenToSchool:number};type Collector={email:string;name:string|null;picture:string|null};type Data={filters:Filter[];collectors:Collector[]};
export default function PaymentTransfersWidget(){const dragId=useRef<number|null>(null), requestVersion=useRef(0), orderBusy=useRef(false); const [ordering,setOrdering]=useState(false); const[data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[open,setOpen]=useState<number|null>(null),[payments,setPayments]=useState<Payment[]>([]),[removing,setRemoving]=useState<number|null>(null),[student,setStudent]=useState<{studentId:number;paymentId:number;purpose:"course"|"practice_donation"}|null>(null);const load=async()=>{try{const r=await fetch("/api/payment-transfer-filters"),b=await readJson<Data&{error?:string}>(r);if(!r.ok)throw Error(b.error);setData(b);setError("")}catch(e){setError(e instanceof Error?e.message:"Could not load saved transfer filters.")}};useEffect(()=>{void load()},[]);async function toggle(f:Filter){
const version=++requestVersion.current;
if(open===f.id){setOpen(null);return}
setOpen(f.id);setPayments([]);setError("");
try{const r=await fetch(`/api/payment-transfer-filters?id=${f.id}`),b=await readJson<{payments?:Payment[];error?:string}>(r);
if(version!==requestVersion.current)return;
if(!r.ok||!b.payments)throw Error(b.error??"Could not load payments.");
setPayments(b.payments);
}catch(e){if(version===requestVersion.current)setError(e instanceof Error?e.message:"Could not load payments.");}
}
async function reorder(source:number,target:number){
if(!data||source===target||orderBusy.current)return;
const previous=data, rows=[...data.filters],from=rows.findIndex(f=>f.id===source),to=rows.findIndex(f=>f.id===target);
if(from<0||to<0)return;
const [moved]=rows.splice(from,1);rows.splice(to,0,moved);
orderBusy.current=true;setOrdering(true);setData({...data,filters:rows});setError("");
try{const r=await fetch("/api/payment-transfer-filters",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({order:rows.map(f=>f.id)})});
const b=await readJson<{error?:string}>(r);if(!r.ok)throw Error(b.error??"Could not save report order.");
}catch(e){setData(previous);setError(e instanceof Error?e.message:"Could not save report order.");}
finally{orderBusy.current=false;setOrdering(false);}
}async function remove(){if(removing===null)return;const r=await fetch(`/api/payment-transfer-filters?id=${removing}`,{method:"DELETE"});setRemoving(null);if(!r.ok)setError("Could not remove report.");else void load()}return <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="m-0 text-lg font-normal">Raports</h2>{error&&<p className="text-sm text-red-700">{error}</p>}<div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left font-sans text-sm"><thead className="bg-[#286653] text-xs text-white"><tr><th className="w-12 p-3"><span className="sr-only">Reorder reports</span></th><th className="p-3">Collected by</th><th className="p-3">From</th><th className="p-3">To</th><th className="p-3">Types</th><th className="p-3 text-right">Total collected</th><th className="p-3">Given to school</th><th className="p-3"/></tr></thead><tbody>{data?.filters.map(f=><Fragment key={f.id}><tr key={f.id} className="cursor-pointer border-b border-stone-200 hover:bg-lime-50" onClick={()=>void toggle(f)} onDragOver={e=>{if(dragId.current!==null&&!ordering){e.preventDefault();e.dataTransfer.dropEffect="move";}}} onDrop={e=>{e.preventDefault();const source=dragId.current;dragId.current=null;if(source!==null)void reorder(source,f.id);}}><td className="p-2"><button type="button" draggable={!ordering} disabled={ordering} aria-label={`Reorder report for ${f.collectorName||f.collectorEmail}; use up or down arrow keys`} title="Drag to rearrange; arrow keys also move this report" className="cursor-grab rounded border border-stone-300 px-2 py-2 text-lg text-slate-600 active:cursor-grabbing disabled:opacity-50" onClick={e=>e.stopPropagation()} onDragStart={e=>{dragId.current=f.id;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",String(f.id));}} onDragEnd={()=>{dragId.current=null;}} onKeyDown={e=>{if(e.key!=="ArrowUp"&&e.key!=="ArrowDown")return;e.preventDefault();e.stopPropagation();const index=data!.filters.findIndex(x=>x.id===f.id),target=data!.filters[index+(e.key==="ArrowUp"?-1:1)];if(target)void reorder(f.id,target.id);}}>⋮⋮</button></td><EditableReportFields filter={f} collectors={data.collectors} onSaved={async()=>{
await load();
if(open===f.id){
const version=++requestVersion.current;
try{const r=await fetch(`/api/payment-transfer-filters?id=${f.id}`),body=await readJson<{payments?:Payment[];error?:string}>(r);if(!r.ok||!body.payments)throw Error(body.error??"Could not refresh payments.");if(version===requestVersion.current)setPayments(body.payments);}
catch(e){if(version===requestVersion.current){setPayments([]);setError(e instanceof Error?e.message:"Could not refresh payments.");}}
}
}} /><td className="p-3 text-right"><button type="button" aria-expanded={open===f.id} className="whitespace-nowrap" aria-label={`${open===f.id?"Collapse":"Expand"} payments for report ${f.id}`}>{open===f.id?"▾ ":"▸ "}{formatMoney(f.totalMinor)} ({f.paymentCount})</button></td><td className="p-3">{f.allGiven?"✓":"□"}</td><td className="p-3"><button className="rounded bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800" onClick={e=>{e.stopPropagation();setRemoving(f.id)}}>Remove</button></td></tr>{open===f.id&&<tr key={`${f.id}-items`}><td colSpan={8} className="bg-stone-50 p-3">{payments.map(p=><button key={`${p.purpose}-${p.id}`} className="mb-2 flex w-full items-center gap-3 rounded border border-stone-200 bg-white p-3 text-left hover:bg-lime-50" onClick={()=>setStudent({studentId:p.studentId,paymentId:p.id,purpose:p.purpose})}>{p.studentPicture?<img src={p.studentPicture} alt="" className="h-8 w-8 rounded-full object-cover"/>:<span className="flex h-8 w-8 items-center justify-center rounded-full bg-lime-100">{(p.firstName||"?")[0]}</span>}<span>{`${p.firstName} ${p.lastName}`.trim()||p.studentEmail} · {formatLogDate(p.paidOn)}<span className="block text-xs text-slate-500">{p.purpose==="practice_donation"?"Practice party donation":"Course payment"} · {p.receivedMethod||"CASH"} · {p.givenToSchool?"Given to school":"Pending school transfer"}</span></span><strong className="ml-auto">{formatMoney(p.amountMinor)}</strong></button>)}</td></tr>}</Fragment>)}{!data?.filters.length&&<tr><td colSpan={8} className="p-8 text-center text-slate-500">No saved reports.</td></tr>}</tbody></table></div>{removing!==null&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><div className="rounded-xl border border-red-300 bg-red-50 p-5"><h3 className="m-0 text-red-950">Remove saved report?</h3><p className="text-sm text-red-900">Payments will not be deleted.</p><div className="flex justify-end gap-2"><button className="rounded border px-3 py-2 text-xs" onClick={()=>setRemoving(null)}>Cancel</button><button className="rounded bg-red-700 px-3 py-2 text-xs font-bold text-white" onClick={()=>void remove()}>Remove report</button></div></div></div>}{student&&<StudentPanel key={`${student.studentId}-${student.purpose}-${student.paymentId}`} id={student.studentId} targetPaymentId={student.paymentId} targetPaymentKind={student.purpose==="practice_donation"?"practice_attendance":"payment"} onClose={()=>setStudent(null)} onUpdate={()=>void load()} onDelete={()=>setStudent(null)}/>}</section>}


type ReportDraft = {collectorEmail:string;fromDate:string;toDate:string;paymentTypes:string[]};
const reportControl="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-xs disabled:opacity-50";
function EditableReportFields({filter,collectors,onSaved}:{filter:Filter;collectors:Collector[];onSaved:()=>Promise<void>}){
  const initial=():ReportDraft=>({collectorEmail:filter.collectorEmail,fromDate:filter.fromDate??"",toDate:filter.toDate??"",paymentTypes:filter.paymentTypes.split(",")});
  const [draft,setDraft]=useState<ReportDraft>(initial);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
  const lock=useRef(false);
  const collectorMenu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{if(!lock.current)setDraft(initial());},[filter.collectorEmail,filter.fromDate,filter.toDate,filter.paymentTypes]);
  async function change(patch:Partial<ReportDraft>){
    if(lock.current)return;
    const next={...draft,...patch};setDraft(next);setSaved(false);setError("");
    if(!next.paymentTypes.length){setError("Select at least one payment type.");return;}
    if(next.fromDate&&next.toDate&&next.fromDate>next.toDate){setError("From must be on or before To. Change either date to save.");return;}
    if([next.fromDate,next.toDate].some(date=>date&&(date<"1900-01-01"||!/^\d{4}-\d{2}-\d{2}$/.test(date)))){setError("Enter a complete date from 1900 onwards.");return;}
    lock.current=true;setBusy(true);
    try{
      const response=await fetch("/api/payment-transfer-filters",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:filter.id,...next})});
      const body=await readJson<{error?:string}>(response);
      if(!response.ok)throw Error(body.error??"Could not save report.");
      await onSaved();setSaved(true);
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not save report.");}
    finally{lock.current=false;setBusy(false);}
  }
  const selected=collectors.find(c=>c.email===draft.collectorEmail)??{email:draft.collectorEmail,name:filter.collectorName,picture:null};
  const stop=(event:{stopPropagation:()=>void})=>event.stopPropagation();
  return <>
    <td className="p-3 align-top" onClick={stop} onKeyDown={stop}>
      <details ref={collectorMenu} className="min-w-40 rounded-md border border-stone-300 bg-white">
        <summary aria-label="Collected by" className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs"><ReportAvatar collector={selected}/><span>{selected.name||selected.email}</span><span aria-hidden="true" className="ml-auto">⌄</span></summary>
        <div className="max-h-60 overflow-y-auto p-1">{collectors.map(c=><button type="button" disabled={busy} key={c.email} aria-pressed={c.email===draft.collectorEmail} className="flex w-full items-center gap-2 rounded p-2 text-left text-xs hover:bg-lime-50 disabled:opacity-50" onClick={()=>{collectorMenu.current?.removeAttribute("open");void change({collectorEmail:c.email});}}><ReportAvatar collector={c}/>{c.name||c.email}</button>)}</div>
      </details>
      <span role="status" className="mt-1 block text-xs text-slate-500">{busy?"Saving…":saved?"Saved":""}</span>
      {error&&<div role="alert" className="mt-1 max-w-60 text-xs text-red-700">{error} <button type="button" className="underline" onClick={()=>void change({})}>Retry</button></div>}
    </td>
    <td className="p-3 align-top" onClick={stop} onKeyDown={stop}><input aria-label="From date" type="date" min="1900-01-01" max={draft.toDate||"9999-12-31"} className={reportControl} value={draft.fromDate} disabled={busy} onChange={e=>void change({fromDate:e.target.value})}/></td>
    <td className="p-3 align-top" onClick={stop} onKeyDown={stop}><input aria-label="To date" type="date" min={draft.fromDate||"1900-01-01"} max="9999-12-31" className={reportControl} value={draft.toDate} disabled={busy} onChange={e=>void change({toDate:e.target.value})}/></td>
    <td className="p-3 align-top" onClick={stop} onKeyDown={stop}><details className="min-w-36 rounded-md border border-stone-300 bg-white"><summary aria-label="Payment types" className="cursor-pointer px-3 py-2 text-xs">{draft.paymentTypes.map(type=>type==="course"?"Courses":"Practice party").join(" + ")||"Select types"}</summary><div className="p-2">{["course","practice_party"].map(type=><label className="flex items-center gap-2 p-1 text-xs" key={type}><input type="checkbox" disabled={busy} checked={draft.paymentTypes.includes(type)} onChange={()=>void change({paymentTypes:draft.paymentTypes.includes(type)?draft.paymentTypes.filter(t=>t!==type):[...draft.paymentTypes,type]})}/>{type==="course"?"Courses":"Practice party"}</label>)}</div></details></td>
  </>;
}
function ReportAvatar({collector}:{collector:Collector}){
 const [failed,setFailed]=useState<string|null>(null);
 return <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-100 text-xs">{collector.picture&&failed!==collector.picture?<img src={collector.picture} alt="" className="h-full w-full object-cover" onError={()=>setFailed(collector.picture)}/>: (collector.name||collector.email).charAt(0).toUpperCase()}</span>;
}

import { useState, useEffect, useRef } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { parseSchoolCsv, CSV_HEADERS } from "@/utils/parseSchoolCsv";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminSchoolYearsTab } from "./AdminSchoolYearsTab";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, UserCheck, UserX, ShieldOff, ChevronDown, ChevronLeft, ChevronRight, Copy, School, Users, Upload, Download, FileText, AlertCircle, CheckCircle2, SkipForward, Archive, ArchiveRestore, Search, Eye, Microscope, BookOpen, GripVertical, Settings2, ArrowLeftRight, Zap } from "lucide-react";
import { safeReturnTo } from "@/lib/safeReturnTo";
import AppHeader from "@/components/AppHeader";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import {
  fetchRubric,
  fetchRubricSets,
  createRubricSet,
  updateRubricSet,
  archiveRubricSet,
  deleteRubricSet,
  reorderRubricSets,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  createDomain,
  updateDomain,
  deleteDomain,
  reorderDomains,
  fetchPeople,
  createPerson,
  updatePerson,
  togglePersonActive,
  reassignPerson,
  startImpersonation,
  bulkImportPeople,
  fetchAdminSchools,
  createAdminSchool,
  updateAdminSchool,
  deleteAdminSchool,
  bulkImportSchools,
  fetchAIQuotaGrants,
  fetchAllAIQuotaGrants,
  createAIQuotaGrant,
  revokeAIQuotaGrant,
  REGIONS,
  GRADE_SPANS,
  type FullRubric,
  type RubricCategoryRow,
  type RubricDomainRow,
  type RubricSetRow,
  type PersonRow,
  type PersonRole,
  type AdminSchool,
  type BulkImportPersonPayload,
  type BulkImportPersonRowResult,
  type BulkSchoolRow,
  type BulkSchoolResult,
  type AIQuotaGrant,
  type AIQuotaGrantType,
  type AIQuotaGrantWithPerson,
  HttpError,
} from "@/lib/api";
import { useUser } from "@/context/UserContext";
import { SUBJECTS, GRADE_LEVELS } from "@/data/dummy";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

const DEPARTMENTS = [
  "English", "Math", "Science", "History", "Spanish",
  "Physical Education", "Comp Sci/Engineering", "Visual Arts", "College", "Other",
] as const;

/* ════════════════════════════════════════════════════════════════
   RUBRIC SETTINGS TAB
   ════════════════════════════════════════════════════════════════ */

function RubricIcon({ target, subjectAudience, size = 14 }: { target?: "TEACHER" | "SCHOOL"; subjectAudience?: "STEM" | "HUMANITIES" | "ALL"; size?: number }) {
  if (target === "SCHOOL") return <School size={size} />;
  if (subjectAudience === "STEM") return <Microscope size={size} />;
  if (subjectAudience === "HUMANITIES") return <BookOpen size={size} />;
  return <Users size={size} />;
}

export function RubricSettings({ setSlug }: { setSlug: string }) {
  const queryClient = useQueryClient();
  const qKey = ["rubric", setSlug] as const;

  const { data, isLoading, isError } = useQuery<FullRubric>({
    queryKey: qKey,
    queryFn: () => fetchRubric(setSlug),
  });

  const [editingCatId,   setEditingCatId]   = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [editingDomId,   setEditingDomId]   = useState<number | null>(null);
  const [editingDomName, setEditingDomName] = useState("");
  const [editingDomSlug, setEditingDomSlug] = useState("");
  const [editingDomDesc, setEditingDomDesc] = useState("");
  const [addingCat,         setAddingCat]         = useState(false);
  const [newCatName,        setNewCatName]        = useState("");
  const [newCatOrder,       setNewCatOrder]       = useState(1);
  const [addingDomForCat,   setAddingDomForCat]   = useState<number | null>(null);
  const [newDomName,        setNewDomName]        = useState("");
  const [newDomSlug,        setNewDomSlug]        = useState("");
  const [newDomOrder,       setNewDomOrder]       = useState(1);
  const [newDomDesc,        setNewDomDesc]        = useState("");
  const [addDomError,       setAddDomError]       = useState<string | null>(null);
  const [updDomError,       setUpdDomError]       = useState<string | null>(null);

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  const addCatMut = useMutation({
    mutationFn: ({ name, order }: { name: string; order: number }) => createCategory(setSlug, name, order),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setAddingCat(false); setNewCatName(""); setNewCatOrder(1); },
  });

  const updCatMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateCategory(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setEditingCatId(null);
    },
  });

  const delCatMut = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
    onError: (err: Error, id: number) => {
      const httpErr = err as HttpError;
      if (httpErr.status === 409 && httpErr.scoreCount !== undefined) {
        const n = httpErr.scoreCount;
        const msg = `This category has ${n} observation score${n === 1 ? "" : "s"} linked to its domains. Deleting it will leave those observations with unresolvable scores.\n\nAre you sure you want to delete anyway?`;
        if (window.confirm(msg)) {
          deleteCategory(id, true)
            .then(() => queryClient.invalidateQueries({ queryKey: qKey }))
            .catch((e: Error) => window.alert(`Delete failed: ${e.message}`));
        }
      }
    },
  });

  const addDomMut = useMutation({
    mutationFn: ({ catId, name, slug, order, desc }: { catId: number; name: string; slug: string; order: number; desc: string }) =>
      createDomain(catId, name, slug, order, desc || undefined),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setAddingDomForCat(null); setNewDomName(""); setNewDomSlug(""); setNewDomOrder(1); setNewDomDesc(""); setAddDomError(null); },
    onError: (err: Error) => setAddDomError(err.message),
  });

  const updDomMut = useMutation({
    mutationFn: ({ id, name, slug, description }: { id: number; name: string; slug: string; description: string }) =>
      updateDomain(id, name, slug, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setEditingDomId(null);
      setUpdDomError(null);
    },
    onError: (err: Error) => setUpdDomError(err.message),
  });

  const delDomMut = useMutation({
    mutationFn: (id: number) => deleteDomain(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
    onError: (err: Error, id: number) => {
      const httpErr = err as HttpError;
      if (httpErr.status === 409 && httpErr.scoreCount !== undefined) {
        const n = httpErr.scoreCount;
        const msg = `This domain has ${n} observation score${n === 1 ? "" : "s"} linked to it. Deleting it will leave those observations with unresolvable scores.\n\nAre you sure you want to delete anyway?`;
        if (window.confirm(msg)) {
          deleteDomain(id, true)
            .then(() => queryClient.invalidateQueries({ queryKey: qKey }))
            .catch((e: Error) => window.alert(`Delete failed: ${e.message}`));
        }
      }
    },
  });

  const catDragItem = useRef<number | null>(null);
  const [catDragOver, setCatDragOver] = useState<number | null>(null);

  const reorderCatMut = useMutation({
    mutationFn: (items: { id: number; displayOrder: number }[]) => reorderCategories(items),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const domDragItem = useRef<number | null>(null);
  const [domDragOver, setDomDragOver] = useState<number | null>(null);

  const reorderDomMut = useMutation({
    mutationFn: (items: { id: number; displayOrder: number }[]) => reorderDomains(items),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  function startEditCat(cat: RubricCategoryRow) {
    setEditingCatId(cat.id); setEditingCatName(cat.name); setEditingDomId(null);
  }

  function startEditDom(dom: RubricDomainRow) {
    setEditingDomId(dom.id); setEditingDomName(dom.name); setEditingDomSlug(dom.slug);
    setEditingDomDesc(dom.description ?? ""); setEditingCatId(null); setUpdDomError(null);
  }

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
    </div>
  );

  if (isError || !data) return (
    <div className="py-10 text-center text-red-600 font-semibold">Failed to load rubric.</div>
  );

  return (
    <div className="flex flex-col gap-5">

      {data.categories.map((cat) => {
        const isCatDragTarget = catDragOver === cat.id;
        return (
        <div
          key={cat.id}
          draggable
          onDragStart={(e) => {
            catDragItem.current = cat.id;
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (catDragOver !== cat.id) setCatDragOver(cat.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const fromId = catDragItem.current;
            catDragItem.current = null;
            setCatDragOver(null);
            if (!fromId || fromId === cat.id) return;
            const cats = data.categories;
            const fromIdx = cats.findIndex((c) => c.id === fromId);
            const toIdx   = cats.findIndex((c) => c.id === cat.id);
            if (fromIdx < 0 || toIdx < 0) return;
            const reordered = [...cats];
            const [moved] = reordered.splice(fromIdx, 1);
            reordered.splice(toIdx, 0, moved);
            reorderCatMut.mutate(reordered.map((c, i) => ({ id: c.id, displayOrder: i })));
          }}
          onDragEnd={() => { setCatDragOver(null); catDragItem.current = null; }}
          className="bg-white rounded-lg shadow-sm overflow-hidden"
          style={{
            border: isCatDragTarget ? `2px solid ${YELLOW}` : "1px solid #dde3f0",
            opacity: reorderCatMut.isPending ? 0.7 : 1,
          }}
        >
          <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
            {editingCatId === cat.id ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  className="flex-1 px-3 py-1 rounded text-sm font-semibold focus:outline-none bg-white"
                  value={editingCatName}
                  onChange={(e) => setEditingCatName(e.target.value)}
                  style={{ color: NAVY }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updCatMut.mutate({ id: cat.id, name: editingCatName });
                    if (e.key === "Escape") setEditingCatId(null);
                  }}
                />
                <button className="text-green-400 hover:text-green-200 p-1" onClick={() => updCatMut.mutate({ id: cat.id, name: editingCatName })}><Check size={16} /></button>
                <button className="text-blue-300 hover:text-white p-1" onClick={() => setEditingCatId(null)}><X size={16} /></button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <GripVertical size={14} className="shrink-0 cursor-grab" style={{ color: "rgba(255,255,255,0.35)" }} />
                  <span className="font-bold uppercase text-white truncate" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.02em" }}>{cat.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip><TooltipTrigger asChild><button title="Edit category" className="text-blue-300 hover:text-white p-1.5 rounded" onClick={() => startEditCat(cat)}><Pencil size={14} /></button></TooltipTrigger><TooltipContent>Edit category</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger asChild><button title="Delete category" className="text-red-400 hover:text-red-200 p-1.5 rounded" onClick={() => { if (window.confirm(`Delete category "${cat.name}" and all its domains? This cannot be undone.`)) delCatMut.mutate(cat.id); }}><Trash2 size={14} /></button></TooltipTrigger><TooltipContent>Delete category</TooltipContent></Tooltip>
                </div>
              </>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            {cat.domains.map((dom) => {
              const isDomDragTarget = domDragOver === dom.id;
              return (
              <div
                key={dom.id}
                draggable
                onDragStart={(e) => {
                  domDragItem.current = dom.id;
                  e.dataTransfer.effectAllowed = "move";
                  e.stopPropagation();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (domDragOver !== dom.id) setDomDragOver(dom.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const fromId = domDragItem.current;
                  domDragItem.current = null;
                  setDomDragOver(null);
                  if (!fromId || fromId === dom.id) return;
                  const fromIdx = cat.domains.findIndex((d) => d.id === fromId);
                  const toIdx   = cat.domains.findIndex((d) => d.id === dom.id);
                  if (fromIdx < 0 || toIdx < 0) return;
                  const reordered = [...cat.domains];
                  const [moved] = reordered.splice(fromIdx, 1);
                  reordered.splice(toIdx, 0, moved);
                  reorderDomMut.mutate(reordered.map((d, i) => ({ id: d.id, displayOrder: i })));
                }}
                onDragEnd={() => { setDomDragOver(null); domDragItem.current = null; }}
                className="px-4 py-2.5 transition-colors"
                style={{
                  backgroundColor: isDomDragTarget ? "#eef1ff" : undefined,
                  borderLeft: isDomDragTarget ? `3px solid ${NAVY}` : undefined,
                  opacity: reorderDomMut.isPending ? 0.7 : 1,
                }}
              >
                {editingDomId === dom.id ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <input className={`${inputCls} flex-1`} value={editingDomName} onChange={(e) => setEditingDomName(e.target.value)} placeholder="Domain name" autoFocus onKeyDown={(e) => { if (e.key === "Escape") { setEditingDomId(null); setUpdDomError(null); } }} />
                      <input className={`${inputCls} w-36`} value={editingDomSlug} onChange={(e) => { setEditingDomSlug(e.target.value); setUpdDomError(null); }} placeholder="slug" onKeyDown={(e) => { if (e.key === "Escape") { setEditingDomId(null); setUpdDomError(null); } }} />
                      <button className="text-green-600 hover:text-green-800 p-1 shrink-0" onClick={() => updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug, description: editingDomDesc })} disabled={updDomMut.isPending}><Check size={16} /></button>
                      <button className="text-slate-400 hover:text-slate-600 p-1 shrink-0" onClick={() => { setEditingDomId(null); setUpdDomError(null); }}><X size={16} /></button>
                    </div>
                    <input
                      className={`${inputCls} w-full text-xs`}
                      value={editingDomDesc}
                      onChange={(e) => setEditingDomDesc(e.target.value)}
                      placeholder="Hover tooltip text — describe what this domain measures…"
                      onKeyDown={(e) => { if (e.key === "Escape") { setEditingDomId(null); setUpdDomError(null); } }}
                    />
                    {updDomError && (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                        <AlertCircle size={13} className="shrink-0" />
                        {updDomError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <GripVertical size={13} className="shrink-0 mt-0.5 cursor-grab text-slate-300 hover:text-slate-500 transition-colors" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-700 text-sm">{dom.name}</span>
                        <code className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded font-mono shrink-0">{dom.slug}</code>
                      </div>
                      {dom.description && (
                        <p className="text-xs text-slate-400 mt-0.5 leading-snug line-clamp-2">{dom.description}</p>
                      )}
                    </div>
                    <Tooltip><TooltipTrigger asChild><button title="Edit domain" className="text-slate-400 hover:text-blue-600 p-1.5 rounded shrink-0" onClick={() => startEditDom(dom)}><Pencil size={13} /></button></TooltipTrigger><TooltipContent>Edit domain</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><button title="Delete domain" className="text-slate-400 hover:text-red-500 p-1.5 rounded shrink-0" onClick={() => { if (confirm(`Delete domain "${dom.name}"?`)) delDomMut.mutate(dom.id); }}><Trash2 size={13} /></button></TooltipTrigger><TooltipContent>Delete domain</TooltipContent></Tooltip>
                  </div>
                )}
              </div>
              );
            })}

            {addingDomForCat === cat.id ? (
              <div className="flex flex-col gap-2 px-4 py-2.5 bg-blue-50">
                <div className="flex items-center gap-2 flex-wrap">
                  <input className={`${inputCls} flex-1 min-w-32`} value={newDomName} onChange={(e) => { setNewDomName(e.target.value); setNewDomSlug(slugify(e.target.value)); setAddDomError(null); }} placeholder="Domain name" autoFocus />
                  <input className={`${inputCls} w-36`} value={newDomSlug} onChange={(e) => { setNewDomSlug(e.target.value); setAddDomError(null); }} placeholder="slug" />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">Position</label>
                    <input
                      className={`${inputCls} w-16 text-center`}
                      type="number"
                      min={1}
                      value={newDomOrder}
                      onChange={(e) => setNewDomOrder(Math.max(1, Number(e.target.value)))}
                    />
                  </div>
                  <button className="px-3 py-1.5 rounded text-sm font-bold text-white shrink-0" style={{ backgroundColor: NAVY }} onClick={() => addDomMut.mutate({ catId: cat.id, name: newDomName, slug: newDomSlug || slugify(newDomName), order: newDomOrder - 1, desc: newDomDesc })} disabled={addDomMut.isPending}>Add</button>
                  <button className="text-slate-400 hover:text-slate-600 p-1 shrink-0" onClick={() => { setAddingDomForCat(null); setNewDomName(""); setNewDomSlug(""); setNewDomOrder(1); setNewDomDesc(""); setAddDomError(null); }}><X size={16} /></button>
                </div>
                <textarea
                  className={`${inputCls} w-full text-xs resize-none`}
                  rows={2}
                  value={newDomDesc}
                  onChange={(e) => setNewDomDesc(e.target.value)}
                  placeholder="Hover tooltip text — describe what this domain measures… (optional)"
                />
                {addDomError && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                    <AlertCircle size={13} className="shrink-0" />
                    {addDomError}
                  </p>
                )}
              </div>
            ) : (
              <button className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold hover:bg-slate-50" style={{ color: NAVY }} onClick={() => { setAddingDomForCat(cat.id); setNewDomName(""); setNewDomSlug(""); setNewDomOrder(cat.domains.length + 1); setAddDomError(null); }}>
                <Plus size={13} />Add domain
              </button>
            )}
          </div>
        </div>
        );
      })}

      {addingCat ? (
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3 flex-wrap" style={{ border: `2px solid ${NAVY}` }}>
          <input
            className={`${inputCls} flex-1 min-w-48 font-semibold`}
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="New category name"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") addCatMut.mutate({ name: newCatName, order: newCatOrder - 1 }); if (e.key === "Escape") setAddingCat(false); }}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">Position</label>
            <input
              className={`${inputCls} w-16 text-center`}
              type="number"
              min={1}
              value={newCatOrder}
              onChange={(e) => setNewCatOrder(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <button className="px-4 py-1.5 rounded font-bold text-white text-sm shrink-0" style={{ backgroundColor: NAVY }} onClick={() => addCatMut.mutate({ name: newCatName, order: newCatOrder - 1 })}>Add Category</button>
          <button className="text-slate-400 hover:text-slate-600 p-1 shrink-0" onClick={() => { setAddingCat(false); setNewCatOrder(1); }}><X size={18} /></button>
        </div>
      ) : (
        <button className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-bold text-sm border-2 border-dashed hover:border-solid" style={{ borderColor: NAVY, color: NAVY }} onClick={() => { setAddingCat(true); setNewCatOrder(data.categories.length + 1); }}>
          <Plus size={16} />Add Category
        </button>
      )}

      <p className="text-center text-slate-400 text-xs pb-4">
        Changes apply to all future and existing observations in {setSlug}. Existing scores for deleted domains will no longer display.
      </p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   RUBRIC SET EDIT DIALOG
   ════════════════════════════════════════════════════════════════ */

function RubricSetEditDialog({ slug, rubricSet, onClose }: { slug: string; rubricSet: RubricSetRow; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [name,          setName]          = useState(rubricSet.name);
  const [slugValue,     setSlugValue]     = useState(rubricSet.slug);
  const [gradeSpanArr,  setGradeSpanArr]  = useState<string[]>(
    rubricSet.gradeSpan ? rubricSet.gradeSpan.split(",").filter(Boolean) : []
  );
  const [audience, setAudience] = useState<"STEM" | "HUMANITIES" | "ALL">(rubricSet.subjectAudience ?? "ALL");
  const [target,   setTarget]   = useState<"TEACHER" | "SCHOOL">(rubricSet.target ?? "TEACHER");

  function invalidate(newSlug?: string) {
    queryClient.invalidateQueries({ queryKey: ["rubricSets"] });
    queryClient.invalidateQueries({ queryKey: ["rubric", slug] });
    if (newSlug && newSlug !== slug) queryClient.invalidateQueries({ queryKey: ["rubric", newSlug] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const saveMut = useMutation({
    mutationFn: () => updateRubricSet(slug, {
      name: name.trim(),
      slug: slugValue.trim().toUpperCase(),
      gradeSpan: gradeSpanArr.length ? gradeSpanArr.join(",") : null,
      target,
      subjectAudience: target === "SCHOOL" ? "ALL" : audience,
    }),
    onSuccess: (updated) => { invalidate(updated.slug); onClose(); },
    onError: (err: Error) => alert(err.message),
  });

  const archiveMut = useMutation({
    mutationFn: (archive: boolean) => archiveRubricSet(slug, archive),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const delSetMut = useMutation({
    mutationFn: () => deleteRubricSet(slug),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: Error) => {
      const httpErr = err as HttpError;
      if (httpErr.status === 409 && httpErr.observationCount !== undefined) {
        const n = httpErr.observationCount;
        const msg = `This rubric set has ${n} observation${n === 1 ? "" : "s"} linked to it. Deleting it will permanently remove all historical observation data for this rubric set.\n\nAre you sure you want to delete anyway?`;
        if (window.confirm(msg)) {
          deleteRubricSet(slug, true)
            .then(() => { invalidate(); onClose(); })
            .catch((e: Error) => window.alert(`Delete failed: ${e.message}`));
        }
      } else {
        window.alert(`Delete failed: ${err.message}`);
      }
    },
  });

  const fieldCls = "px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white w-full";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}>
          <div className="flex items-center gap-2.5">
            <span style={{ color: YELLOW }}>
              <RubricIcon target={rubricSet.target} subjectAudience={rubricSet.subjectAudience} size={18} />
            </span>
            <h2 className="text-white font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}>
              Edit Rubric Settings
            </h2>
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Name</label>
            <input
              className={fieldCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) saveMut.mutate(); }}
            />
          </div>

          {/* Slug */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Slug <span className="font-normal text-slate-400 text-xs">(appears in URLs)</span></label>
            <input
              className={fieldCls}
              value={slugValue}
              onChange={(e) => setSlugValue(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
              placeholder="e.g. LAUNCH"
              spellCheck={false}
            />
            <p className="text-xs text-slate-400">Letters, numbers, hyphens, underscores only. Changing this will break any bookmarked links.</p>
          </div>

          {/* Rubric Type toggle — first */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Rubric Type</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 w-fit">
              {(["TEACHER", "SCHOOL"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTarget(opt)}
                  className="px-4 py-2 text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: target === opt ? NAVY : "white",
                    color: target === opt ? YELLOW : "#475569",
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 14,
                    letterSpacing: "0.04em",
                  }}
                >
                  {opt === "TEACHER" ? "Teacher-Facing" : "School-Wide"}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {target === "SCHOOL"
                ? "Used for school-wide observations, not tied to a specific teacher's rubric."
                : "Used for teacher-specific classroom observations."}
            </p>
          </div>

          {/* Grade Spans — pill buttons */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-slate-700">Grade Spans</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 w-fit">
              {GRADE_SPANS.map((gs) => {
                const active = gradeSpanArr.includes(gs);
                return (
                  <button
                    key={gs}
                    type="button"
                    onClick={() => setGradeSpanArr((p) => active ? p.filter((g) => g !== gs) : [...p, gs])}
                    className="px-4 py-2 text-sm font-semibold transition-colors"
                    style={{
                      backgroundColor: active ? NAVY : "white",
                      color: active ? YELLOW : "#475569",
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 14,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {gs === "ES" ? "Elementary" : gs === "MS" ? "Middle" : "High School"}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-400">
              {gradeSpanArr.length ? `Scoped to: ${gradeSpanArr.join(", ")}` : "All grade spans"}
            </p>
          </div>

          {/* Subject Audience — pill buttons, only for teacher rubrics */}
          {target !== "SCHOOL" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-slate-700">Subject Audience</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-200 w-fit">
                {(["ALL", "STEM", "HUMANITIES"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAudience(opt)}
                    className="px-4 py-2 text-sm font-semibold transition-colors"
                    style={{
                      backgroundColor: audience === opt ? NAVY : "white",
                      color: audience === opt ? YELLOW : "#475569",
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 14,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {opt === "ALL" ? "All Subjects" : opt === "STEM" ? "STEM" : "Humanities"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                {audience === "STEM"
                  ? "Only shown for teachers in STEM departments."
                  : audience === "HUMANITIES"
                  ? "Only shown for teachers in Humanities departments."
                  : "Shown for all teachers regardless of department."}
              </p>
            </div>
          )}
        </div>

        {/* Footer — archive/delete on left, cancel/save on right */}
        <div className="px-5 pb-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-3">
            {rubricSet.isArchived ? (
              <button
                disabled={archiveMut.isPending}
                onClick={() => archiveMut.mutate(false)}
                className="flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:text-green-800 transition-colors disabled:opacity-50"
              >
                <ArchiveRestore size={14} />
                Restore
              </button>
            ) : (
              <button
                disabled={archiveMut.isPending}
                onClick={() => { if (confirm(`Archive "${rubricSet.name}"? It will be hidden from the dashboard until restored.`)) archiveMut.mutate(true); }}
                className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 hover:text-amber-800 transition-colors disabled:opacity-50"
              >
                <Archive size={14} />
                Archive
              </button>
            )}
            <button
              disabled={delSetMut.isPending}
              onClick={() => {
                if (confirm(`Permanently delete "${rubricSet.name}"? This cannot be undone.`)) {
                  delSetMut.mutate();
                }
              }}
              className="flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-800 transition-colors disabled:opacity-50"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg font-bold text-white hover:opacity-90 transition-opacity border border-slate-200"
              style={{ backgroundColor: "#e2e8f0", color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
            >
              Cancel
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={!name.trim() || !slugValue.trim() || saveMut.isPending}
              className="px-5 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
            >
              {saveMut.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   REASSIGN MODAL
   Closes the current active Assignment and opens a new one with
   the chosen role + school — never edits the existing record.
   ════════════════════════════════════════════════════════════════ */

function ReassignModal({
  person,
  schools,
  onClose,
  onSuccess,
}: {
  person:    PersonRow;
  schools:   AdminSchool[];
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const NAVY_LOCAL = "#1034B4";
  const YELLOW_LOCAL = "#FFB500";
  const ALL_ROLES_LOCAL: PersonRole[] = ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN", "NO_ACCESS"];
  const ROLES_LABEL: Record<PersonRole, string> = {
    COACH: "Coach", SCHOOL_LEADER: "School Leader",
    NETWORK_LEADER: "Network Leader", NETWORK_ADMIN: "Network Admin", NO_ACCESS: "No Access",
  };

  const realSchools       = schools.filter((s) => !s.isHomeOffice);
  const homeOfficeSchools = schools.filter((s) =>  s.isHomeOffice);

  const [role,     setRole]     = useState<PersonRole>(person.role);
  const [schoolId, setSchoolId] = useState<number | null>(person.schoolId);
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);

  const isNetworkRole = (["NETWORK_LEADER", "NETWORK_ADMIN"] as PersonRole[]).includes(role);
  const availableSchools = isNetworkRole ? homeOfficeSchools : realSchools;
  const selectedIsHO     = homeOfficeSchools.some((s) => s.id === schoolId);
  const mismatch =
    (isNetworkRole && !selectedIsHO) ||
    (!isNetworkRole && selectedIsHO && role !== "NO_ACCESS");

  function handleRoleChange(r: PersonRole) {
    setRole(r);
    const nextNetworkRole = (["NETWORK_LEADER", "NETWORK_ADMIN"] as PersonRole[]).includes(r);
    const list = nextNetworkRole ? homeOfficeSchools : realSchools;
    setSchoolId(list[0]?.id ?? null);
    setError(null);
  }

  async function handleSave() {
    if (!schoolId) { setError("School is required."); return; }
    if (mismatch)  { setError("Role/school mismatch."); return; }
    setSaving(true);
    setError(null);
    try {
      await reassignPerson(person.employeeId, { role, schoolId });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  }

  const unchanged = role === person.role && schoolId === person.schoolId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ backgroundColor: NAVY_LOCAL, borderBottom: `3px solid ${YELLOW_LOCAL}` }}>
          <div className="flex items-center gap-2.5">
            <ArrowLeftRight size={16} style={{ color: YELLOW_LOCAL }} />
            <h2 className="text-white font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.04em" }}>
              Edit Assignment
            </h2>
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white p-1"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          <p className="text-sm text-slate-500">
            Changing <span className="font-semibold text-slate-700">{person.name}</span>'s assignment will close
            today's record and open a new one. Historical observations keep their original school snapshot.
          </p>

          {/* Role */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</label>
            <select
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={role}
              onChange={(e) => handleRoleChange(e.target.value as PersonRole)}
            >
              {ALL_ROLES_LOCAL.map((r) => (
                <option key={r} value={r}>{ROLES_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {/* School */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">School</label>
            <select
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={schoolId ?? ""}
              onChange={(e) => { setSchoolId(e.target.value ? Number(e.target.value) : null); setError(null); }}
            >
              <option value="">— Select school —</option>
              {availableSchools.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
            {mismatch && (
              <p className="text-xs font-medium mt-0.5" style={{ color: "#b45309" }}>
                {isNetworkRole
                  ? "Network-level roles must be assigned to the Home Office school."
                  : "Coaches and School Leaders must be assigned to a real school."}
              </p>
            )}
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
            <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              This takes effect immediately. Only new records will reflect the new school. Existing observations and action steps are unaffected.
            </p>
          </div>

          {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !schoolId || mismatch || unchanged}
            className="px-4 py-2 rounded text-sm font-bold text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: NAVY_LOCAL }}
          >
            {saving ? "Saving…" : "Save Assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   AI QUOTA MODAL
   Network admins can grant extra AI requests to specific users.
   ════════════════════════════════════════════════════════════════ */

function AIQuotaModal({ person, onClose }: { person: PersonRow; onClose: () => void }) {
  const NAVY_LOCAL   = "#1034B4";
  const YELLOW_LOCAL = "#FFB500";
  const queryClient  = useQueryClient();
  const qKey         = ["ai-quota-grants", person.employeeId] as const;

  const { data: grants = [], isLoading } = useQuery<AIQuotaGrant[]>({
    queryKey: qKey,
    queryFn:  () => fetchAIQuotaGrants(person.employeeId),
  });

  const [grantType,      setGrantType]      = useState<AIQuotaGrantType>("chat");
  const [extraRequests,  setExtraRequests]  = useState(20);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [note,           setNote]           = useState("");
  const [adding,         setAdding]         = useState(false);

  const createMut = useMutation({
    mutationFn: () => createAIQuotaGrant({
      employeeId: person.employeeId,
      grantType,
      extraRequests,
      expiresInHours,
      note: note.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setAdding(false);
      setNote("");
    },
    onError: (err: Error) => alert(err.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => revokeAIQuotaGrant(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const now = Date.now();

  function formatExpiry(expiresAt: string) {
    const diff = new Date(expiresAt).getTime() - now;
    if (diff <= 0) return "Expired";
    const hrs  = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
    if (hrs > 0)   return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }

  const GRANT_LABELS: Record<AIQuotaGrantType, string> = {
    chat:       "Chat",
    generation: "Generation",
    all:        "All AI",
  };

  const active  = grants.filter((g) => new Date(g.expiresAt).getTime() > now && g.usedRequests < g.extraRequests);
  const expired = grants.filter((g) => new Date(g.expiresAt).getTime() <= now || g.usedRequests >= g.extraRequests);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ backgroundColor: NAVY_LOCAL, borderBottom: `3px solid ${YELLOW_LOCAL}` }}>
          <div className="flex items-center gap-2.5">
            <Zap size={16} style={{ color: YELLOW_LOCAL }} />
            <h2 className="text-white font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.04em" }}>
              AI Quota — {person.name}
            </h2>
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white p-1"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4 p-5 overflow-y-auto">
          {/* Active grants */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Active Grants</p>
            {isLoading ? (
              <p className="text-sm text-slate-400 italic">Loading…</p>
            ) : active.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No active grants for this user.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {active.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-green-200 bg-green-50">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">{GRANT_LABELS[g.grantType]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700">
                        {g.usedRequests}/{g.extraRequests} used
                        <span className="ml-2 text-xs font-normal text-slate-400">· expires in {formatExpiry(g.expiresAt)}</span>
                      </p>
                      {g.note && <p className="text-xs text-slate-400 truncate">{g.note}</p>}
                    </div>
                    <button
                      className="text-red-400 hover:text-red-600 p-1.5 rounded transition-colors disabled:opacity-50 shrink-0"
                      title="Revoke grant"
                      onClick={() => { if (confirm("Revoke this quota grant?")) revokeMut.mutate(g.id); }}
                      disabled={revokeMut.isPending}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expired / exhausted grants */}
          {expired.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Expired / Exhausted</p>
              <div className="flex flex-col gap-1.5">
                {expired.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 opacity-60">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 shrink-0">{GRANT_LABELS[g.grantType]}</span>
                    <p className="flex-1 text-xs text-slate-500">
                      {g.usedRequests}/{g.extraRequests} used · {new Date(g.expiresAt).getTime() <= now ? "Expired" : "Exhausted"}
                    </p>
                    <button
                      className="text-slate-300 hover:text-red-400 p-1 rounded transition-colors disabled:opacity-40 shrink-0"
                      title="Remove record"
                      onClick={() => revokeMut.mutate(g.id)}
                      disabled={revokeMut.isPending}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add grant form */}
          {adding ? (
            <div className="flex flex-col gap-3 p-4 rounded-lg border-2 border-dashed" style={{ borderColor: NAVY_LOCAL }}>
              <p className="text-sm font-bold" style={{ color: NAVY_LOCAL }}>New Quota Grant</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</label>
                  <select
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                    value={grantType}
                    onChange={(e) => setGrantType(e.target.value as AIQuotaGrantType)}
                  >
                    <option value="chat">Chat (bypasses 20/15min limit)</option>
                    <option value="generation">Generation (bypasses 10/15min)</option>
                    <option value="all">All AI (bypasses both limits)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Extra Requests</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    value={extraRequests}
                    onChange={(e) => setExtraRequests(Math.max(1, Math.min(500, Number(e.target.value))))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Expires In</label>
                  <select
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                    value={expiresInHours}
                    onChange={(e) => setExpiresInHours(Number(e.target.value))}
                  >
                    <option value={4}>4 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={48}>48 hours</option>
                    <option value={72}>72 hours</option>
                    <option value={168}>7 days</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note (optional)</label>
                  <input
                    type="text"
                    maxLength={120}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="e.g. End-of-quarter review"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  className="px-4 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50"
                  style={{ backgroundColor: NAVY_LOCAL }}
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                >
                  {createMut.isPending ? "Granting…" : "Grant Quota"}
                </button>
                <button
                  className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                  onClick={() => { setAdding(false); setNote(""); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-bold text-sm border-2 border-dashed hover:border-solid transition-all"
              style={{ borderColor: NAVY_LOCAL, color: NAVY_LOCAL }}
              onClick={() => setAdding(true)}
            >
              <Plus size={14} />
              Add Quota Grant
            </button>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg font-bold text-sm text-white"
            style={{ backgroundColor: NAVY_LOCAL }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   PEOPLE MANAGEMENT TAB (unified people + bulk import)
   ════════════════════════════════════════════════════════════════ */

const ALL_ROLES_MAP: Record<PersonRole, string> = {
  COACH:          "Coach",
  SCHOOL_LEADER:  "School Leader",
  NETWORK_LEADER: "Network Leader",
  NETWORK_ADMIN:  "Network Admin",
  NO_ACCESS:      "No Access",
};

function PeopleManagement({ isNetworkAdmin, canBulkImport, canWrite }: { isNetworkAdmin: boolean; canBulkImport: boolean; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const qKey = ["admin", "teachers"] as const;
  const [view, setView] = useState<"list" | "bulk">("list");
  const { refetch: refetchUser } = useUser();
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const { data: people = [], isLoading } = useQuery<PersonRow[]>({
    queryKey: qKey,
    queryFn: () => fetchPeople({ includeInactive: true }),
  });

  const { data: schools = [] } = useQuery<AdminSchool[]>({
    queryKey: ["admin", "schools"],
    queryFn: fetchAdminSchools,
    enabled: isNetworkAdmin,
  });

  /* Add form state */
  const [adding, setAdding]             = useState(false);
  const [addFirstName, setAddFirstName] = useState("");
  const [addLastName,  setAddLastName]  = useState("");
  const [addEmpId,     setAddEmpId]     = useState("");
  const [addEmail,     setAddEmail]     = useState("");
  const [addRole,      setAddRole]      = useState<PersonRole>("COACH");
  const [addSchoolId,  setAddSchoolId]  = useState<number | null>(null);
  const [addDept,      setAddDept]      = useState("");
  const [addGrades,    setAddGrades]    = useState<string[]>([]);
  const [addObservable, setAddObservable] = useState(true);

  /* Edit form state */
  const [editId,          setEditId]          = useState<string | null>(null);
  const [editFirstName,   setEditFirstName]   = useState("");
  const [editLastName,    setEditLastName]    = useState("");
  const [editEmail,       setEditEmail]       = useState("");
  const [editRole,        setEditRole]        = useState<PersonRole>("COACH");
  const [editSchoolId,    setEditSchoolId]    = useState<number | null>(null);
  const [editDept,        setEditDept]        = useState("");
  const [editGrades,      setEditGrades]      = useState<string[]>([]);
  const [editObservable,  setEditObservable]  = useState(false);

  /* Reassign modal state */
  const [reassignTarget,  setReassignTarget]  = useState<PersonRow | null>(null);
  /* AI Quota modal state */
  const [quotaTarget,     setQuotaTarget]     = useState<PersonRow | null>(null);

  /* Filter state */
  const [showInactive,    setShowInactive]    = useState(false);
  const [search,          setSearch]          = useState("");
  const [filterRoles,     setFilterRoles]     = useState<string[]>([]);
  const [filterSchools,   setFilterSchools]   = useState<string[]>([]);
  const [filterObservable, setFilterObservable] = useState(false);

  /* Pagination */
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";
  const selCls   = `${inputCls} cursor-pointer`;

  const availableRoles: PersonRole[] = isNetworkAdmin
    ? ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN", "NO_ACCESS"]
    : ["COACH", "SCHOOL_LEADER", "NO_ACCESS"];

  const createMut = useMutation({
    mutationFn: () => createPerson({
      employeeId:              addEmpId.trim(),
      email:                   addEmail.trim(),
      firstName:               addFirstName.trim(),
      lastName:                addLastName.trim(),
      role:                    addRole,
      schoolId:                addSchoolId,
      department:              addDept.trim() || null,
      gradeLevel:              addGrades,
      includeInFeedbackTracker: addObservable,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setAdding(false);
      setAddFirstName(""); setAddLastName(""); setAddEmpId(""); setAddEmail(""); setAddRole("COACH"); setAddSchoolId(realSchools[0]?.id ?? null); setAddDept(""); setAddGrades([]); setAddObservable(true);
    },
    onError: (err: Error) => alert(err.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updatePerson(editId!, {
      email:                   editEmail.trim(),
      firstName:               editFirstName.trim(),
      lastName:                editLastName.trim(),
      role:                    editRole,
      department:              editDept.trim() || null,
      gradeLevel:              editGrades,
      includeInFeedbackTracker: editObservable,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setEditId(null); },
    onError: (err: Error) => alert(err.message),
  });

  const toggleMut = useMutation({
    mutationFn: (employeeId: string) => togglePersonActive(employeeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
    onError: (err: Error) => alert(err.message),
  });

  function startEdit(p: PersonRow) {
    setEditId(p.employeeId);
    setEditFirstName(p.firstName);
    setEditLastName(p.lastName);
    setEditEmail(p.email);
    setEditRole(p.role);
    setEditSchoolId(p.schoolId);
    setEditDept(p.department ?? "");
    setEditGrades(p.gradeLevel);
    setEditObservable(p.includeInFeedbackTracker);
    setAdding(false);
  }

  async function handleImpersonate(p: PersonRow) {
    setImpersonatingId(p.employeeId);
    try {
      await startImpersonation(p.employeeId);
      await refetchUser();
      window.location.href = "/";
    } catch (err) {
      alert((err as Error).message ?? "Failed to start impersonation");
      setImpersonatingId(null);
    }
  }

  function toggleAddGrade(g: string) { setAddGrades((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]); }
  function toggleEditGrade(g: string) { setEditGrades((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]); }

  const realSchools         = schools.filter((s) => !s.isHomeOffice);
  const homeOfficeSchools   = schools.filter((s) => s.isHomeOffice);
  const homeOfficeSchoolId  = homeOfficeSchools[0]?.id ?? null;
  const schoolNameOptions   = realSchools.map((s) => s.displayName);
  const addSchoolIsHO           = homeOfficeSchoolId !== null && addSchoolId === homeOfficeSchoolId;
  const editSchoolIsHO          = homeOfficeSchoolId !== null && editSchoolId === homeOfficeSchoolId;
  const addRoleSchoolMismatch   = isNetworkAdmin && addSchoolId !== null && (
    (addSchoolIsHO  && (["COACH", "SCHOOL_LEADER"] as PersonRole[]).includes(addRole)) ||
    (!addSchoolIsHO && (["NETWORK_LEADER", "NETWORK_ADMIN"] as PersonRole[]).includes(addRole))
  );
  const filtersActive = filterRoles.length > 0 || filterSchools.length > 0;

  const shown = people.filter((p) => {
    if (showInactive ? p.isActive : !p.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.email.toLowerCase().includes(q)) return false;
    }
    if (filterRoles.length > 0) {
      const matchedEnums = filterRoles.map((label) =>
        (Object.entries(ALL_ROLES_MAP) as [string, string][]).find(([, v]) => v === label)?.[0] ?? ""
      );
      if (!matchedEnums.includes(p.role)) return false;
    }
    if (filterSchools.length > 0) {
      const schoolName = schools.find((s) => s.id === p.schoolId)?.displayName ?? "";
      if (!filterSchools.includes(schoolName)) return false;
    }
    return true;
  }).sort((a, b) => {
    const last = a.lastName.localeCompare(b.lastName);
    return last !== 0 ? last : a.firstName.localeCompare(b.firstName);
  });

  const totalPages  = Math.max(1, Math.ceil(shown.length / pageSize));
  const safePage    = Math.min(page, totalPages);
  const pageStart   = (safePage - 1) * pageSize;
  const paged       = shown.slice(pageStart, pageStart + pageSize);

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
    </div>
  );

  if (view === "bulk" && canBulkImport) {
    return (
      <div className="flex flex-col flex-1">
        <div className="px-4 sm:px-6 flex gap-6" style={{ backgroundColor: "white", borderBottom: "1px solid #e2e8f0" }}>
          <button onClick={() => setView("list")} className="flex items-center gap-2 py-3 text-sm font-semibold transition-colors" style={{ color: "#64748b", borderBottom: "2px solid transparent", marginBottom: -1 }}>User List</button>
          <button className="flex items-center gap-2 py-3 text-sm font-semibold transition-colors" style={{ color: NAVY, borderBottom: `2px solid ${YELLOW}`, marginBottom: -1 }}>
            Bulk Upload
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5">
          <PeopleBulkImport isNetworkAdmin={isNetworkAdmin} onDone={() => { setView("list"); queryClient.invalidateQueries({ queryKey: qKey }); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      {canBulkImport && (
      <div className="px-4 sm:px-6 flex gap-6" style={{ backgroundColor: "white", borderBottom: "1px solid #e2e8f0" }}>
        <button className="flex items-center gap-2 py-3 text-sm font-semibold transition-colors" style={{ color: NAVY, borderBottom: `2px solid ${YELLOW}`, marginBottom: -1 }}>User List</button>
        <button onClick={() => setView("bulk")} className="flex items-center gap-2 py-3 text-sm font-semibold transition-colors" style={{ color: "#64748b", borderBottom: "2px solid transparent", marginBottom: -1 }}>
          Bulk Upload
        </button>
      </div>
      )}

      <div className="px-4 sm:px-6 py-5 flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="pl-8 pr-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white w-52"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setSearch("")}><X size={12} /></button>}
        </div>

        <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} />
        <span className="font-bold uppercase tracking-widest shrink-0" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}>Filters</span>

        <FilterMultiSelect label="Role" values={filterRoles} onChange={setFilterRoles} options={availableRoles.map((r) => ALL_ROLES_MAP[r])} />
        {isNetworkAdmin && schoolNameOptions.length > 0 && (
          <FilterMultiSelect label="School" values={filterSchools} onChange={setFilterSchools} options={schoolNameOptions} />
        )}
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-blue-700" />
          Show inactive only
        </label>
        {(filtersActive || search) && (
          <button onClick={() => { setFilterRoles([]); setFilterSchools([]); setSearch(""); }} className="font-semibold underline underline-offset-2 text-sm" style={{ color: NAVY }}>
            Clear all
          </button>
        )}

        {canWrite && (
        <div className="ml-auto">
          <button
            onClick={() => { setAdding(true); setEditId(null); setAddRole("COACH"); setAddSchoolId(realSchools[0]?.id ?? null); }}
            className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90 shrink-0"
            style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
          >
            <Plus size={14} />Add Person
          </button>
        </div>
        )}
      </div>

      {/* Add person form */}
      {adding && (
        <div className="bg-white rounded-lg p-4 flex flex-col gap-3 shadow-sm" style={{ border: `2px solid ${NAVY}` }}>
          <p className="font-bold text-slate-700 text-sm">Add New Person</p>
          <div className="flex flex-wrap gap-3">
            <input className={`${inputCls} flex-1 min-w-[130px]`} value={addFirstName} onChange={(e) => setAddFirstName(e.target.value)} placeholder="First name *" autoFocus />
            <input className={`${inputCls} flex-1 min-w-[130px]`} value={addLastName} onChange={(e) => setAddLastName(e.target.value)} placeholder="Last name *" />
            <input className={`${inputCls} flex-1 min-w-[120px]`} value={addEmpId} onChange={(e) => setAddEmpId(e.target.value)} placeholder="Employee ID *" />
            <input type="email" className={`${inputCls} flex-1 min-w-[200px]`} value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="Email *" />
            <select className={`${selCls} min-w-[150px]`} value={addRole} onChange={(e) => {
              const r = e.target.value as PersonRole;
              setAddRole(r);
              const isNR = (["NETWORK_LEADER", "NETWORK_ADMIN"] as PersonRole[]).includes(r);
              setAddSchoolId((isNR ? homeOfficeSchools : realSchools)[0]?.id ?? null);
            }}>
              {availableRoles.map((r) => <option key={r} value={r}>{ALL_ROLES_MAP[r]}</option>)}
            </select>
            {isNetworkAdmin && (
              <select className={`${selCls} min-w-[160px]`} value={addSchoolId ?? ""} onChange={(e) => setAddSchoolId(e.target.value ? Number(e.target.value) : null)}>
                {((["NETWORK_LEADER", "NETWORK_ADMIN"] as PersonRole[]).includes(addRole) ? homeOfficeSchools : realSchools).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
              </select>
            )}
            <select className={`${selCls} min-w-[180px]`} value={addDept} onChange={(e) => setAddDept(e.target.value)}>
              <option value="">— Department —</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1.5 font-medium">Grade levels:</p>
            <div className="flex flex-wrap gap-1.5">
              {GRADE_LEVELS.map((g) => (
                <button key={g} type="button" onClick={() => toggleAddGrade(g)} className="px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors"
                  style={addGrades.includes(g) ? { backgroundColor: NAVY, color: "white", borderColor: NAVY } : { backgroundColor: "white", color: NAVY, borderColor: "#c7d2e8" }}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 select-none">
            <input type="checkbox" checked={addObservable} onChange={(e) => setAddObservable(e.target.checked)} className="accent-blue-700 w-4 h-4" />
            Include in Feedback Tracker (observable subject)
          </label>
          {isNetworkAdmin && !addSchoolId && (
            <p className="text-xs font-medium" style={{ color: "#b45309" }}>School is required.</p>
          )}
          {addRoleSchoolMismatch && addSchoolIsHO && (
            <p className="text-xs font-medium" style={{ color: "#b45309" }}>
              Coaches and School Leaders cannot be assigned to the Home Office school.
            </p>
          )}
          {addRoleSchoolMismatch && !addSchoolIsHO && (
            <p className="text-xs font-medium" style={{ color: "#b45309" }}>
              Network Leaders and Admins must be assigned to the Home Office school.
            </p>
          )}
          {isNetworkAdmin && addObservable && addSchoolIsHO && !addRoleSchoolMismatch && (
            <p className="text-xs font-medium" style={{ color: "#b45309" }}>
              Feedback tracker participants cannot be assigned to the Home Office school.
            </p>
          )}
          <div className="flex gap-2">
            <button className="px-4 py-1.5 rounded font-bold text-white text-sm disabled:opacity-50" style={{ backgroundColor: NAVY }}
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !addFirstName.trim() || !addLastName.trim() || !addEmpId.trim() || !addEmail.trim() || (isNetworkAdmin && !addSchoolId) || addRoleSchoolMismatch || (addObservable && addSchoolIsHO)}>
              {createMut.isPending ? "Adding…" : "Add Person"}
            </button>
            <button className="px-4 py-1.5 rounded font-semibold text-slate-600 text-sm hover:bg-slate-100" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: isNetworkAdmin ? "24%" : "28%" }} />
            <col style={{ width: isNetworkAdmin ? "26%" : "34%" }} />
            <col style={{ width: "18%" }} />
            {isNetworkAdmin && <col style={{ width: "15%" }} />}
            <col style={{ width: isNetworkAdmin ? "17%" : "20%" }} />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: NAVY }}>
              {["Name", "Email", "Role", ...(isNetworkAdmin ? ["School"] : []), "Edit / View"].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-white font-bold uppercase" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
            <tr style={{ height: 3, backgroundColor: YELLOW }}><td colSpan={isNetworkAdmin ? 5 : 4} style={{ padding: 0, height: 3 }} /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.length === 0 && (
              <tr><td colSpan={isNetworkAdmin ? 5 : 4} className="text-center py-8 text-slate-400">No people found.</td></tr>
            )}
            {people.length > 0 && shown.length === 0 && (
              <tr><td colSpan={isNetworkAdmin ? 5 : 4} className="text-center py-8 text-slate-400">No {showInactive ? "inactive" : "active"} people match your filters.</td></tr>
            )}
            {paged.map((p) => (
              <tr key={p.employeeId}>
                {editId === p.employeeId ? (
                  <td colSpan={isNetworkAdmin ? 5 : 4} className="px-4 py-3 bg-blue-50">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap gap-3 items-start">
                        <input className={`${inputCls} flex-1 min-w-[130px]`} value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} placeholder="First name" autoFocus />
                        <input className={`${inputCls} flex-1 min-w-[130px]`} value={editLastName} onChange={(e) => setEditLastName(e.target.value)} placeholder="Last name" />
                        <input type="email" className={`${inputCls} flex-1 min-w-[200px]`} value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" />
                        <select className={`${selCls} min-w-[150px]`} value={editRole} onChange={(e) => setEditRole(e.target.value as PersonRole)}>
                          {availableRoles.map((r) => <option key={r} value={r}>{ALL_ROLES_MAP[r]}</option>)}
                        </select>
                        {isNetworkAdmin && (
                          <span className="flex items-center gap-1 px-3 py-1.5 rounded border border-slate-200 bg-slate-50 text-sm text-slate-600 min-w-[160px]">
                            {schools.find((s) => s.id === editSchoolId)?.displayName ?? "—"}
                            <span className="text-xs text-slate-400 ml-1">(use Reassign to change)</span>
                          </span>
                        )}
                        <select className={`${selCls} min-w-[180px]`} value={editDept} onChange={(e) => setEditDept(e.target.value)}>
                          <option value="">— Department —</option>
                          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1.5 font-medium">Grade levels:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {GRADE_LEVELS.map((g) => (
                            <button key={g} type="button" onClick={() => toggleEditGrade(g)} className="px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors"
                              style={editGrades.includes(g) ? { backgroundColor: NAVY, color: "white", borderColor: NAVY } : { backgroundColor: "white", color: NAVY, borderColor: "#c7d2e8" }}>
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 select-none">
                        <input type="checkbox" checked={editObservable} onChange={(e) => setEditObservable(e.target.checked)} className="accent-blue-700 w-4 h-4" />
                        Include in Feedback Tracker (observable subject)
                      </label>
                      {isNetworkAdmin && editObservable && editSchoolIsHO && (
                        <p className="text-xs font-medium" style={{ color: "#b45309" }}>
                          Feedback tracker participants cannot be assigned to the Home Office school.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 rounded font-bold text-white text-sm disabled:opacity-50" style={{ backgroundColor: NAVY }} onClick={() => updateMut.mutate()} disabled={updateMut.isPending || (editObservable && editSchoolIsHO)}>{updateMut.isPending ? "Saving…" : "Save"}</button>
                        <button className="px-3 py-1.5 rounded font-semibold text-slate-600 text-sm hover:bg-slate-100" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-2 whitespace-nowrap" style={{ opacity: p.isActive ? 1 : 0.5, maxWidth: 220 }}>
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <span className="font-medium text-slate-800 truncate">{p.name}</span>
                        {p.includeInFeedbackTracker && (
                          <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full" style={{ backgroundColor: "#fef9c3" }} title="Observable teacher">
                            <Eye size={10} style={{ color: "#92400e" }} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap" style={{ opacity: p.isActive ? 1 : 0.5, maxWidth: 200 }}>
                      <span className="block truncate">{p.email}</span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap" style={{ opacity: p.isActive ? 1 : 0.5 }}>
                      <span className="text-xs font-bold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ backgroundColor: "#e0e7ff", color: NAVY }}>
                        {ALL_ROLES_MAP[p.role] ?? p.role}
                      </span>
                    </td>
                    {isNetworkAdmin && (
                      <td className="px-4 py-2 text-slate-500 whitespace-nowrap" style={{ opacity: p.isActive ? 1 : 0.5, maxWidth: 160 }}>
                        {(() => {
                          if (p.schoolOrphaned) return (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 cursor-help" title={`School record not found (ID ${p.schoolId}) — this assignment may be orphaned. Re-assign this person to a valid school.`}>
                              <AlertCircle size={12} className="shrink-0" />
                              Unknown school #{p.schoolId}
                            </span>
                          );
                          const resolved = p.schoolName ?? schools.find((s) => s.id === p.schoolId)?.displayName;
                          if (resolved) return <span className="block truncate">{resolved}</span>;
                          return <span className="text-slate-300 italic">—</span>;
                        })()}
                      </td>
                    )}
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {canWrite && (
                          <button className="text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors disabled:opacity-40" title={isNetworkAdmin && schools.length === 0 ? "Loading schools…" : "Edit"} disabled={isNetworkAdmin && schools.length === 0} onClick={() => startEdit(p)}>
                            <Pencil size={13} />
                          </button>
                        )}
                        {isNetworkAdmin && (
                          <button
                            className="text-slate-400 hover:text-violet-600 p-1.5 rounded transition-colors disabled:opacity-40"
                            title="Edit Assignment (role / school)"
                            disabled={schools.length === 0}
                            onClick={() => { setReassignTarget(p); setEditId(null); }}
                          >
                            <ArrowLeftRight size={13} />
                          </button>
                        )}
                        {canWrite && (
                          <button
                            className={`p-1.5 rounded transition-colors ${p.isActive ? "text-slate-400 hover:text-red-500" : "text-slate-400 hover:text-green-600"}`}
                            title={p.isActive ? "Deactivate" : "Reactivate"}
                            onClick={() => toggleMut.mutate(p.employeeId)}
                            disabled={toggleMut.isPending}
                          >
                            {p.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                          </button>
                        )}
                        {isNetworkAdmin && (
                          <button
                            className="text-slate-400 hover:text-indigo-600 p-1.5 rounded transition-colors disabled:opacity-50"
                            title={`Impersonate ${p.name}`}
                            onClick={() => handleImpersonate(p)}
                            disabled={impersonatingId === p.employeeId}
                          >
                            <Users size={13} />
                          </button>
                        )}
                        {isNetworkAdmin && (
                          <button
                            className="text-slate-400 hover:text-yellow-500 p-1.5 rounded transition-colors"
                            title="AI Quota Grants"
                            onClick={() => setQuotaTarget(p)}
                          >
                            <Zap size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="grid items-center pt-1 pb-2" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
        <p className="text-xs text-slate-400">
          {shown.length === 0
            ? "No users to show"
            : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, shown.length)} of ${shown.length} user${shown.length !== 1 ? "s" : ""}`}
        </p>

          {/* Page buttons — center */}
          <div className="flex items-center gap-1">
            <button
              className="w-7 h-7 flex items-center justify-center rounded border text-xs font-semibold transition-colors disabled:opacity-30"
              style={{ borderColor: "#dde3f0", color: NAVY }}
              disabled={safePage === 1}
              onClick={() => setPage(1)}
              title="First page"
            ><ChevronLeft size={12} /><ChevronLeft size={12} /></button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded border text-xs font-semibold transition-colors disabled:opacity-30"
              style={{ borderColor: "#dde3f0", color: NAVY }}
              disabled={safePage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              title="Previous page"
            ><ChevronLeft size={14} /></button>

            {/* Page number pills */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
              .reduce<(number | "…")[]>((acc, n, idx, arr) => {
                if (idx > 0 && n - (arr[idx - 1] as number) > 1) acc.push("…");
                acc.push(n);
                return acc;
              }, [])
              .map((n, i) =>
                n === "…"
                  ? <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-slate-400">…</span>
                  : <button
                      key={n}
                      className="w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors"
                      style={n === safePage
                        ? { backgroundColor: NAVY, color: "white" }
                        : { border: "1px solid #dde3f0", color: NAVY }}
                      onClick={() => setPage(n as number)}
                    >{n}</button>
              )}

            <button
              className="w-7 h-7 flex items-center justify-center rounded border text-xs font-semibold transition-colors disabled:opacity-30"
              style={{ borderColor: "#dde3f0", color: NAVY }}
              disabled={safePage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              title="Next page"
            ><ChevronRight size={14} /></button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded border text-xs font-semibold transition-colors disabled:opacity-30"
              style={{ borderColor: "#dde3f0", color: NAVY }}
              disabled={safePage === totalPages}
              onClick={() => setPage(totalPages)}
              title="Last page"
            ><ChevronRight size={12} /><ChevronRight size={12} /></button>
          </div>

          {/* Per-page picker — right */}
          <label className="flex items-center justify-end gap-1.5 text-xs text-slate-500">
            Per page
            <select
              className="border border-slate-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
      </div>
      </div>
      {reassignTarget && (
        <ReassignModal
          person={reassignTarget}
          schools={schools}
          onClose={() => setReassignTarget(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: qKey });
            setReassignTarget(null);
          }}
        />
      )}
      {quotaTarget && (
        <AIQuotaModal
          person={quotaTarget}
          onClose={() => setQuotaTarget(null)}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SCHOOL SETTINGS TAB (District Admin only)
   ════════════════════════════════════════════════════════════════ */

const REGION_COLORS: Record<string, { bg: string; color: string }> = {
  Boston:    { bg: "#dbeafe", color: "#1d4ed8" },
  Camden:    { bg: "#fef9c3", color: "#854d0e" },
  NYC:       { bg: "#f3e8ff", color: "#7e22ce" },
  Newark:    { bg: "#dcfce7", color: "#15803d" },
  Rochester: { bg: "#ffe4e6", color: "#be123c" },
};

const GRADE_SPAN_COLORS: Record<string, { bg: string; color: string }> = {
  ES: { bg: "#fef3c7", color: "#92400e" },
  MS: { bg: "#e0f2fe", color: "#0369a1" },
  HS: { bg: "#f0fdf4", color: "#166534" },
};

/* ════════════════════════════════════════════════════════════════
   SCHOOL CSV UPLOAD MODAL
   ════════════════════════════════════════════════════════════════ */

function downloadTemplate() {
  const rows = [
    CSV_HEADERS.join(","),
    `"Example School ES","Example School Elementary School","EX_ES","Newark","ES"`,
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "schools_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function SchoolCsvModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [parsedRows,   setParsedRows]   = useState<BulkSchoolRow[]>([]);
  const [headerError,  setHeaderError]  = useState<string | null>(null);
  const [fileName,     setFileName]     = useState<string | null>(null);
  const [result,       setResult]       = useState<BulkSchoolResult | null>(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setSubmitError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows, headerError } = parseSchoolCsv(text);
      setParsedRows(rows);
      setHeaderError(headerError);
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (parsedRows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await bulkImportSchools(parsedRows);
      setResult(res);
      if (res.added > 0 || res.updated > 0) onSuccess();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  const validRows   = parsedRows.filter((r) => r.displayName && r.fullName && r.abbreviation && r.region && r.gradeSpan);
  const allRegions  = new Set(REGIONS as readonly string[]);
  const allSpans    = new Set(GRADE_SPANS as readonly string[]);

  function rowWarning(r: BulkSchoolRow): string | null {
    if (!r.displayName || !r.fullName || !r.abbreviation || !r.region || !r.gradeSpan) return "Missing required field(s)";
    if (!allRegions.has(r.region))  return `Unknown region "${r.region}"`;
    if (!allSpans.has(r.gradeSpan)) return `Unknown grade span "${r.gradeSpan}"`;
    return null;
  }

  const hasRowErrors = parsedRows.some((r) => rowWarning(r) !== null);
  const canSubmit    = !headerError && parsedRows.length > 0 && !result && !hasRowErrors;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}>
          <div className="flex items-center gap-2.5">
            <Upload size={18} style={{ color: YELLOW }} />
            <h2 className="text-white font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}>
              Upload Schools CSV
            </h2>
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white p-1"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 p-5 overflow-y-auto flex-1">

          {/* Step 1 — Template */}
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
            <FileText size={16} className="text-slate-400 shrink-0" />
            <span className="text-sm text-slate-600 flex-1">Need the format? Download the template CSV first.</span>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded font-bold text-sm border"
              style={{ borderColor: NAVY, color: NAVY }}
            >
              <Download size={13} />Template
            </button>
          </div>

          {/* Step 2 — File picker */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-700">Upload CSV file</label>
            <div
              className="flex items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={18} className="text-slate-400 shrink-0" />
              <span className="text-sm text-slate-500">{fileName ?? "Click to choose a .csv file"}</span>
              {fileName && <Check size={16} className="text-green-500 shrink-0 ml-auto" />}
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>

          {/* Header error */}
          {headerError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              {headerError}
            </div>
          )}

          {/* Preview table */}
          {!headerError && parsedRows.length > 0 && !result && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">{parsedRows.length} row{parsedRows.length !== 1 ? "s" : ""} parsed</span>
                {(() => { const errCount = parsedRows.filter((r) => rowWarning(r) !== null).length; return errCount > 0 ? (
                  <span className="text-xs font-semibold text-red-600">{errCount} row{errCount !== 1 ? "s have" : " has"} errors</span>
                ) : null; })()}
              </div>
              <div className="rounded-lg border border-slate-200 overflow-auto" style={{ maxHeight: 280 }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: NAVY, color: "white" }}>
                      {["#", "Display Name", "Full Name", "Abbr.", "Region", "Grade", ""].map((h) => (
                        <th key={h} className="px-2.5 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.map((r, i) => {
                      const warn = rowWarning(r);
                      return (
                        <tr key={i} className={warn ? "bg-red-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                          <td className="px-2.5 py-1.5 text-slate-400">{i + 2}</td>
                          <td className="px-2.5 py-1.5 font-medium text-slate-800 max-w-[140px] truncate">{r.displayName || <span className="text-red-400 italic">—</span>}</td>
                          <td className="px-2.5 py-1.5 text-slate-600 max-w-[160px] truncate">{r.fullName || <span className="text-red-400 italic">—</span>}</td>
                          <td className="px-2.5 py-1.5 font-mono text-slate-500">{r.abbreviation || <span className="text-red-400 italic">—</span>}</td>
                          <td className="px-2.5 py-1.5 text-slate-600">{r.region || <span className="text-red-400 italic">—</span>}</td>
                          <td className="px-2.5 py-1.5 text-slate-600">{r.gradeSpan || <span className="text-red-400 italic">—</span>}</td>
                          <td className="px-2.5 py-1.5">
                            {warn
                              ? <span title={warn}><AlertCircle size={13} className="text-red-400" /></span>
                              : <Check size={13} className="text-green-500" />
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Submit error */}
          {submitError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />{submitError}
            </div>
          )}

          {/* Result summary */}
          {result && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                {result.added > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-sm font-semibold text-green-700">
                    <CheckCircle2 size={15} />{result.added} added
                  </div>
                )}
                {result.updated > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm font-semibold text-blue-700">
                    <CheckCircle2 size={15} />{result.updated} updated
                  </div>
                )}
                {result.failed.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm font-semibold text-red-700">
                    <AlertCircle size={15} />{result.failed.length} failed
                  </div>
                )}
                {result.added === 0 && result.updated === 0 && result.failed.length === 0 && (
                  <div className="text-sm text-slate-500">No rows were processed.</div>
                )}
              </div>

              {result.failed.length > 0 && (
                <div className="rounded-lg border border-red-200 overflow-hidden">
                  <div className="px-3 py-2 bg-red-50 text-xs font-semibold text-red-700 uppercase tracking-wide">Failed rows</div>
                  <div className="divide-y divide-red-100" style={{ maxHeight: 200, overflowY: "auto" }}>
                    {result.failed.map((f) => (
                      <div key={f.row} className="flex items-start gap-3 px-3 py-2 text-xs">
                        <span className="font-bold text-slate-500 shrink-0">Row {f.row}</span>
                        <span className="text-red-600">{f.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 shrink-0 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded font-semibold text-sm text-slate-600 hover:bg-slate-100">
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="flex items-center gap-2 px-5 py-2 rounded font-bold text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: NAVY }}
            >
              {submitting ? (
                <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Importing…</>
              ) : (
                <><Upload size={14} />Import {parsedRows.length > 0 ? `${parsedRows.length} School${parsedRows.length !== 1 ? "s" : ""}` : "Schools"}</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SCHOOLS SETTINGS PANEL
   ════════════════════════════════════════════════════════════════ */

function SchoolSettings() {
  const queryClient = useQueryClient();
  const qKey = ["admin", "schools"] as const;

  const { data: schools = [], isLoading } = useQuery<AdminSchool[]>({
    queryKey: qKey,
    queryFn: fetchAdminSchools,
  });

  /* Add form */
  const [adding, setAdding]               = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newFullName, setNewFullName]       = useState("");
  const [newAbbr, setNewAbbr]               = useState("");
  const [newRegion, setNewRegion]           = useState("");
  const [newSpan, setNewSpan]               = useState("");

  /* Edit form */
  const [editId, setEditId]               = useState<number | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editFullName, setEditFullName]     = useState("");
  const [editAbbr, setEditAbbr]             = useState("");
  const [editRegion, setEditRegion]         = useState("");
  const [editSpan, setEditSpan]             = useState("");

  /* Filters */
  const [schoolSearch,    setSchoolSearch]    = useState("");
  const [filterRegions,   setFilterRegions]   = useState<string[]>([]);
  const [filterGradeSpans, setFilterGradeSpans] = useState<string[]>([]);

  /* CSV upload modal */
  const [showCsvModal, setShowCsvModal] = useState(false);

  function resetAdd() { setAdding(false); setNewDisplayName(""); setNewFullName(""); setNewAbbr(""); setNewRegion(""); setNewSpan(""); }
  function resetEdit() { setEditId(null); }

  const createMut = useMutation({
    mutationFn: () => createAdminSchool({
      displayName:  newDisplayName.trim(),
      fullName:     newFullName.trim(),
      abbreviation: newAbbr.trim(),
      region:       newRegion,
      gradeSpan:    newSpan,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); resetAdd(); },
  });

  const updateMut = useMutation({
    mutationFn: () => updateAdminSchool(editId!, {
      displayName:  editDisplayName.trim(),
      fullName:     editFullName.trim(),
      abbreviation: editAbbr.trim(),
      region:       editRegion,
      gradeSpan:    editSpan,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); resetEdit(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAdminSchool(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
    onError: (err: Error) => alert(err.message),
  });

  function startEdit(s: AdminSchool) {
    setEditId(s.id);
    setEditDisplayName(s.displayName);
    setEditFullName(s.fullName ?? "");
    setEditAbbr(s.abbreviation ?? "");
    setEditRegion(s.region ?? "");
    setEditSpan(s.gradeSpan ?? "");
    setAdding(false);
  }

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";
  const selCls   = `${inputCls} cursor-pointer`;

  const schoolFiltersActive = filterRegions.length > 0 || filterGradeSpans.length > 0;

  const shownSchools = schools.filter((s) => {
    if (s.isHomeOffice) return false;
    if (schoolSearch && !s.displayName.toLowerCase().includes(schoolSearch.toLowerCase())) return false;
    if (filterRegions.length > 0 && !filterRegions.includes(s.region ?? "")) return false;
    if (filterGradeSpans.length > 0 && !filterGradeSpans.includes(s.gradeSpan ?? "")) return false;
    return true;
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="pl-8 pr-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white w-52"
            placeholder="Search schools…"
            value={schoolSearch}
            onChange={(e) => setSchoolSearch(e.target.value)}
          />
          {schoolSearch && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setSchoolSearch("")}><X size={12} /></button>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} />

        {/* Filters label */}
        <span className="font-bold uppercase tracking-widest shrink-0" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}>
          Filters
        </span>

        <FilterMultiSelect label="Region" values={filterRegions} onChange={setFilterRegions} options={[...REGIONS]} />
        <FilterMultiSelect label="Grade Span" values={filterGradeSpans} onChange={setFilterGradeSpans} options={[...GRADE_SPANS]} />

        {(schoolFiltersActive || schoolSearch) && (
          <button
            onClick={() => { setFilterRegions([]); setFilterGradeSpans([]); setSchoolSearch(""); }}
            className="font-semibold underline underline-offset-2 text-sm"
            style={{ color: NAVY }}
          >
            Clear all
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowCsvModal(true)}
            className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90 shrink-0 border"
            style={{ borderColor: NAVY, color: NAVY }}
          >
            <Upload size={14} />
            Upload CSV
          </button>
          <button
            onClick={() => { setAdding(true); setEditId(null); setNewDisplayName(""); setNewFullName(""); setNewAbbr(""); setNewRegion(""); setNewSpan(""); }}
            className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90 shrink-0"
            style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
          >
            <Plus size={14} />
            Add School
          </button>
        </div>
      </div>

      {showCsvModal && (
        <SchoolCsvModal
          onClose={() => setShowCsvModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: qKey })}
        />
      )}

      {/* Add school form */}
      {adding && (
        <div className="bg-white rounded-lg p-4 flex flex-col gap-3 shadow-sm" style={{ border: `2px solid ${NAVY}` }}>
          <div className="flex flex-wrap gap-3">
            <input
              className={`${inputCls} flex-1 min-w-[200px]`}
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="Display Name *"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Escape") resetAdd(); }}
            />
            <input
              className={`${inputCls} flex-1 min-w-[200px]`}
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              placeholder="Full Name (for CSV matching) *"
            />
            <input
              className={`${inputCls} w-32`}
              value={newAbbr}
              onChange={(e) => setNewAbbr(e.target.value)}
              placeholder="Abbrev. *"
            />
            <select className={`${selCls} min-w-[130px]`} value={newRegion} onChange={(e) => setNewRegion(e.target.value)}>
              <option value="">— Region —</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className={`${selCls} min-w-[120px]`} value={newSpan} onChange={(e) => setNewSpan(e.target.value)}>
              <option value="">— Grade Span —</option>
              {GRADE_SPANS.map((g) => <option key={g} value={g}>{g === "ES" ? "ES (Elementary)" : g === "MS" ? "MS (Middle)" : "HS (High School)"}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              className="px-4 py-1.5 rounded font-bold text-white text-sm disabled:opacity-50"
              style={{ backgroundColor: NAVY }}
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !newDisplayName.trim() || !newFullName.trim() || !newAbbr.trim() || !newRegion || !newSpan}
            >
              {createMut.isPending ? "Adding…" : "Add School"}
            </button>
            <button className="px-4 py-1.5 rounded font-semibold text-slate-600 text-sm hover:bg-slate-100" onClick={resetAdd}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schools list */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        {schools.length === 0 && !adding && (
          <div className="text-center py-10 text-slate-400 text-sm">No schools yet. Add your first school above.</div>
        )}
        {schools.length > 0 && shownSchools.length === 0 && (
          <div className="text-center py-10 text-slate-400 text-sm">No schools match your filters.</div>
        )}
        {shownSchools.length > 0 && (
          <>
            <div className="px-4 py-3" style={{ backgroundColor: NAVY, display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 0.5fr 0.75fr 72px" }}>
              {["Display Name", "Full Name", "Abbrev.", "Grade", "Region", "Actions"].map((h, i) => (
                <div key={i} className={`text-white font-bold uppercase${i === 5 ? " text-right" : " text-left"}`} style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.05em" }}>{h}</div>
              ))}
            </div>
            <div style={{ height: 3, backgroundColor: YELLOW }} />
          </>
        )}
        <ul className="divide-y divide-slate-100">
          {shownSchools.map((school) => (
            <li key={school.id}>
              {editId === school.id ? (
                /* ── Inline edit form ── */
                <div className="px-4 py-3 bg-blue-50 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-3">
                    <input
                      className={`${inputCls} flex-1 min-w-[180px]`}
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      placeholder="Display Name"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Escape") resetEdit(); }}
                    />
                    <input
                      className={`${inputCls} flex-1 min-w-[180px]`}
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      placeholder="Full Name (for CSV matching) *"
                    />
                    <input
                      className={`${inputCls} w-28`}
                      value={editAbbr}
                      onChange={(e) => setEditAbbr(e.target.value)}
                      placeholder="Abbrev. *"
                    />
                    <select className={`${selCls} min-w-[130px]`} value={editRegion} onChange={(e) => setEditRegion(e.target.value)}>
                      <option value="">— Region —</option>
                      {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select className={`${selCls} min-w-[120px]`} value={editSpan} onChange={(e) => setEditSpan(e.target.value)}>
                      <option value="">— Grade Span —</option>
                      {GRADE_SPANS.map((g) => <option key={g} value={g}>{g === "ES" ? "ES (Elementary)" : g === "MS" ? "MS (Middle)" : "HS (High School)"}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-4 py-1.5 rounded font-bold text-white text-sm disabled:opacity-50"
                      style={{ backgroundColor: NAVY }}
                      onClick={() => updateMut.mutate()}
                      disabled={updateMut.isPending || !editDisplayName.trim() || !editFullName.trim() || !editAbbr.trim() || !editRegion || !editSpan}
                    >
                      {updateMut.isPending ? "Saving…" : "Save"}
                    </button>
                    <button className="px-4 py-1.5 rounded font-semibold text-slate-600 text-sm hover:bg-slate-100" onClick={resetEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Display row ── */
                <div
                  className="px-4 py-3 hover:bg-slate-50 transition-colors items-center"
                  style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 0.5fr 0.75fr 72px" }}
                >
                  {/* Display Name */}
                  <span className="flex items-center gap-2 font-medium text-slate-700 text-sm min-w-0">
                    <School size={16} className="text-slate-300 shrink-0" />
                    <span className="truncate">{school.displayName}</span>
                  </span>
                  {/* Full Name */}
                  <span className="text-sm text-slate-500 truncate pr-2">
                    {school.fullName || <span className="text-slate-300">—</span>}
                  </span>
                  {/* Abbreviation */}
                  <span className="text-sm text-slate-500">
                    {school.abbreviation || <span className="text-slate-300">—</span>}
                  </span>
                  {/* Grade Span */}
                  <div>
                    {school.gradeSpan ? (
                      <span
                        className="text-xs font-bold rounded-full px-2 py-0.5"
                        style={{
                          backgroundColor: (GRADE_SPAN_COLORS[school.gradeSpan] ?? { bg: "#f1f5f9" }).bg,
                          color: (GRADE_SPAN_COLORS[school.gradeSpan] ?? { color: "#475569" }).color,
                        }}
                      >
                        {school.gradeSpan}
                      </span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </div>
                  {/* Region */}
                  <div>
                    {school.region ? (
                      <span
                        className="text-xs font-bold rounded-full px-2 py-0.5"
                        style={{
                          backgroundColor: (REGION_COLORS[school.region] ?? { bg: "#f1f5f9" }).bg,
                          color: (REGION_COLORS[school.region] ?? { color: "#475569" }).color,
                        }}
                      >
                        {school.region}
                      </span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </div>
                  {/* Edit / Delete */}
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      className="text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors"
                      title="Edit"
                      onClick={() => startEdit(school)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="text-slate-400 hover:text-red-500 p-1.5 rounded transition-colors"
                      title="Delete"
                      onClick={() => { if (confirm(`Delete "${school.displayName}"? This will fail if teachers are still assigned to it.`)) deleteMut.mutate(school.id); }}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-center text-slate-400 text-xs pb-2">
        Schools with teachers assigned cannot be deleted. Reassign or remove all teachers first.
      </p>
    </div>
  );
}
/* ════════════════════════════════════════════════════════════════
   PEOPLE BULK IMPORT
   ════════════════════════════════════════════════════════════════ */

const PEOPLE_CSV_TEMPLATE = [
  "firstName,lastName,employeeId,email,role,school,department,gradeLevel,includeInFeedbackTracker",
  "Jane,Smith,EMP001,jane.smith@school.org,COACH,Lincoln Middle School,Math,6-7-8,true",
  "Carlos,Rivera,EMP002,c.rivera@school.org,SCHOOL_LEADER,Jefferson High School,,9-10-11-12,false",
].join("\n");

function downloadPeopleTemplate() {
  const blob = new Blob([PEOPLE_CSV_TEMPLATE], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "people_import_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let field = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field.trim());
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) {
        fields.push(line.slice(i).trim());
        break;
      }
      fields.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return fields;
}

function parsePeopleCSV(text: string): BulkImportPersonPayload[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const results: BulkImportPersonPayload[] = [];
  if (lines.length < 2) return results;

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const idx = (n: string) => headers.indexOf(n);
  const firstNameIdx = idx("firstname");
  const lastNameIdx  = idx("lastname");
  const empIdIdx     = idx("employeeid");
  const emailIdx     = idx("email");
  const roleIdx      = idx("role");
  const schoolIdx    = idx("school");
  const deptIdx      = idx("department");
  const gradeIdx     = idx("gradelevel");
  const obsIdx       = idx("includeinfeedbacktracker");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const gradRaw = gradeIdx >= 0 ? (cols[gradeIdx] ?? "") : "";
    results.push({
      firstName:  firstNameIdx >= 0 ? (cols[firstNameIdx] ?? "") : "",
      lastName:   lastNameIdx  >= 0 ? (cols[lastNameIdx]  ?? "") : "",
      employeeId: empIdIdx     >= 0 ? (cols[empIdIdx]     ?? "") : "",
      email:      emailIdx     >= 0 ? (cols[emailIdx]     ?? "") : "",
      role:       roleIdx      >= 0 ? (cols[roleIdx]      ?? "") : "",
      school:     schoolIdx    >= 0 ? (cols[schoolIdx]    ?? "") : "",
      department: deptIdx      >= 0 ? (cols[deptIdx]      ?? "") : "",
      gradeLevel: gradRaw,
      includeInFeedbackTracker: obsIdx >= 0 ? (cols[obsIdx] ?? "true") : "true",
    });
  }
  return results;
}

function PeopleBulkImport({ isNetworkAdmin, onDone }: { isNetworkAdmin: boolean; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<BulkImportPersonPayload[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [importResult, setImportResult] = useState<BulkImportPersonRowResult[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) { alert("Please upload a .csv file."); return; }
    setFileName(file.name);
    setImportResult(null);
    setSubmitError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setPreview(parsePeopleCSV(text));
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (!preview || preview.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await bulkImportPeople(preview);
      setImportResult(result.results);
      setPreview(null);
      setFileName("");
    } catch (err) {
      setSubmitError((err as Error).message ?? "Import failed");
    } finally {
      setSubmitting(false);
    }
  }

  const created  = importResult?.filter((r) => r.status === "created")  ?? [];
  const assigned = importResult?.filter((r) => r.status === "assigned") ?? [];
  const skipped  = importResult?.filter((r) => r.status === "skipped")  ?? [];
  const errors   = importResult?.filter((r) => r.status === "error")    ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Upload zone */}
      {!importResult && (
        <div className="flex flex-col gap-4">

          {/* Drop zone */}
          <div
            className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-4 text-center cursor-pointer transition-all hover:shadow-md"
            style={{ borderColor: "#c7d2e8", backgroundColor: "#f4f7ff", padding: "2rem 1.5rem" }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
              <Upload size={24} color={YELLOW} />
            </div>
            {fileName ? (
              <div>
                <p className="font-bold text-slate-800 text-sm">{fileName}</p>
                <p className="text-xs text-slate-400 mt-1">Click to choose a different file</p>
              </div>
            ) : (
              <div>
                <p className="font-bold text-slate-700">Drop your CSV here</p>
                <p className="text-sm text-slate-400 mt-1">or click to browse files</p>
              </div>
            )}
            <button
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90"
              style={{ backgroundColor: NAVY, color: "white" }}
              onClick={(e) => { e.stopPropagation(); downloadPeopleTemplate(); }}
            >
              <Download size={13} />
              Download template CSV
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {/* Column reference table */}
          <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "66%" }} />
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: NAVY }}>
                  {["Column", "Required", "Description"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-white font-bold uppercase" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
                <tr style={{ height: 3, backgroundColor: YELLOW }}><td colSpan={3} style={{ padding: 0, height: 3 }} /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  { col: "firstName",                    req: true,  desc: "Person's first name." },
                  { col: "lastName",                     req: true,  desc: "Person's last name." },
                  { col: "email",                        req: true,  desc: "Work email address." },
                  { col: "role",                         req: true,  desc: "COACH · SCHOOL_LEADER · NETWORK_LEADER · NETWORK_ADMIN · NO_ACCESS" },
                  { col: "employeeId",                   req: true,  desc: "Unique ID from your HR system (e.g. EMP0042). Must match the employee's ID exactly." },
                  { col: "school",                       req: false, desc: "Exact school name as it appears in Settings → Schools." },
                  { col: "department",                   req: false, desc: "English · Math · Science · History · Spanish · Phys Ed · Comp Sci · Visual Arts · College · Other" },
                  { col: "gradeLevel",                   req: false, desc: "Hyphen-separated grades, e.g. 6-7-8 or K-1." },
                  { col: "includeInFeedbackTracker",     req: false, desc: "true for teachers who receive observations; false for admins/coaches. Defaults to true." },
                ].map(({ col, req, desc }) => (
                  <tr key={col}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#f1f5f9", color: NAVY }}>{col}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {req
                        ? <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#fee2e2", color: "#b91c1c" }}>Yes</span>
                        : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 leading-relaxed">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Preview table */}
      {preview && preview.length > 0 && !importResult && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-700 text-sm">{preview.length} people ready to import</p>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded text-sm text-slate-600 hover:bg-slate-100 font-semibold" onClick={() => { setPreview(null); setFileName(""); }}>Clear</button>
              <button
                className="px-4 py-1.5 rounded font-bold text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
                style={{ backgroundColor: NAVY }}
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Importing…" : `Import ${preview.length} people`}
              </button>
            </div>
          </div>
          {submitError && <p className="text-sm text-red-600 font-medium">{submitError}</p>}
          <div className="bg-white rounded-lg shadow-sm overflow-auto max-h-80" style={{ border: "1px solid #dde3f0" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: NAVY, color: "white" }}>
                  <th className="text-left px-3 py-2">First Name</th>
                  <th className="text-left px-3 py-2">Last Name</th>
                  <th className="text-left px-3 py-2">Employee ID</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-left px-3 py-2">School</th>
                  <th className="text-left px-3 py-2">Observable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((p, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-3 py-1.5">{p.firstName}</td>
                    <td className="px-3 py-1.5">{p.lastName}</td>
                    <td className="px-3 py-1.5 text-slate-400">{p.employeeId ?? "—"}</td>
                    <td className="px-3 py-1.5">{p.email}</td>
                    <td className="px-3 py-1.5">{p.role}</td>
                    <td className="px-3 py-1.5">{p.school}</td>
                    <td className="px-3 py-1.5">{p.includeInFeedbackTracker ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results */}
      {importResult && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-wrap gap-3">
              {created.length > 0 && (
                <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ backgroundColor: "#dcfce7", color: "#15803d" }}>
                  {created.length} new {created.length === 1 ? "hire" : "hires"} added
                </span>
              )}
              {assigned.length > 0 && (
                <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ backgroundColor: "#dbeafe", color: "#1d4ed8" }}>
                  {assigned.length} returning {assigned.length === 1 ? "person" : "people"} re-assigned
                </span>
              )}
              {skipped.length > 0 && (
                <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ backgroundColor: "#fef9c3", color: "#a16207" }}>
                  {skipped.length} already up to date
                </span>
              )}
              {errors.length > 0 && (
                <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ backgroundColor: "#fee2e2", color: "#b91c1c" }}>
                  {errors.length} {errors.length === 1 ? "error" : "errors"}
                </span>
              )}
              {importResult.length === 0 && (
                <span className="text-sm text-slate-500">No rows processed</span>
              )}
            </div>
            <button
              className="shrink-0 px-4 py-1.5 rounded font-bold text-white text-sm"
              style={{ backgroundColor: NAVY }}
              onClick={onDone}
            >
              Done
            </button>
          </div>

          {created.length > 0 && (
            <ResultSection
              title={`New hires added (${created.length})`}
              rows={created}
              headerStyle={{ backgroundColor: "#15803d", color: "white" }}
              statusBadge={() => <span className="text-xs font-bold text-green-700 bg-green-100 rounded-full px-2 py-0.5">New</span>}
            />
          )}
          {assigned.length > 0 && (
            <ResultSection
              title={`Returning staff re-assigned (${assigned.length})`}
              rows={assigned}
              headerStyle={{ backgroundColor: "#1d4ed8", color: "white" }}
              statusBadge={() => <span className="text-xs font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">Re-assigned</span>}
            />
          )}
          {skipped.length > 0 && (
            <ResultSection
              title={`Already up to date (${skipped.length})`}
              rows={skipped}
              headerStyle={{ backgroundColor: "#d97706", color: "white" }}
              statusBadge={(r) => <span className="text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">{r.reason ?? "No change"}</span>}
            />
          )}
          {errors.length > 0 && (
            <ResultSection
              title={`Errors (${errors.length})`}
              rows={errors}
              headerStyle={{ backgroundColor: "#dc2626", color: "white" }}
              statusBadge={(r) => <span className="text-xs font-bold text-red-700 bg-red-100 rounded-full px-2 py-0.5">{r.reason ?? "Error"}</span>}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  rows,
  headerStyle,
  statusBadge,
}: {
  title: string;
  rows: BulkImportPersonRowResult[];
  headerStyle: React.CSSProperties;
  statusBadge: (r: BulkImportPersonRowResult) => React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
      <div className="px-4 py-2.5" style={{ ...headerStyle, borderBottom: `2px solid ${YELLOW}` }}>
        <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.04em" }}>
          {title}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">#</th>
            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.row}>
              <td className="px-3 py-2 text-slate-400 text-xs">{r.row}</td>
              <td className="px-3 py-2 font-medium text-slate-800">{r.name ?? "—"}</td>
              <td className="px-3 py-2 text-slate-600">{r.email ?? "—"}</td>
              <td className="px-3 py-2">{statusBadge(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   AI QUOTA TAB
   Network admins can manage quota grants for all users.
   ════════════════════════════════════════════════════════════════ */

function AIQuotaTab() {
  const queryClient = useQueryClient();
  const [showAll,       setShowAll]       = useState(false);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [search,        setSearch]        = useState("");

  const [grantEmployeeId,    setGrantEmployeeId]    = useState("");
  const [grantType,          setGrantType]          = useState<AIQuotaGrantType>("chat");
  const [grantExtraRequests, setGrantExtraRequests] = useState(20);
  const [grantExpiresHours,  setGrantExpiresHours]  = useState(24);
  const [grantNote,          setGrantNote]          = useState("");

  const qKey = ["ai-quota-grants-all", showAll] as const;

  const { data: grants = [], isLoading } = useQuery<AIQuotaGrantWithPerson[]>({
    queryKey: qKey,
    queryFn:  () => fetchAllAIQuotaGrants(showAll),
  });

  const { data: allPeople = [] } = useQuery<PersonRow[]>({
    queryKey: ["people"],
    queryFn:  () => fetchPeople({ includeInactive: false }),
    staleTime: 60_000,
  });

  const createMut = useMutation({
    mutationFn: () => createAIQuotaGrant({
      employeeId:     grantEmployeeId,
      grantType,
      extraRequests:  grantExtraRequests,
      expiresInHours: grantExpiresHours,
      note:           grantNote.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-quota-grants-all"] });
      setShowGrantForm(false);
      setGrantEmployeeId("");
      setGrantNote("");
    },
    onError: (err: Error) => alert(err.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => revokeAIQuotaGrant(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ["ai-quota-grants-all"] }),
  });

  const now = Date.now();

  function formatExpiry(expiresAt: string) {
    const diff = new Date(expiresAt).getTime() - now;
    if (diff <= 0) return "Expired";
    const hrs  = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
    if (hrs > 0)   return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }

  const GRANT_LABELS: Record<AIQuotaGrantType, string> = {
    chat:       "Chat",
    generation: "Generation",
    all:        "All AI",
  };

  const filtered = grants.filter((g) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = `${g.personFirstName ?? ""} ${g.personLastName ?? ""}`.toLowerCase();
    return (
      name.includes(q) ||
      (g.personEmail ?? "").toLowerCase().includes(q) ||
      g.employeeId.toLowerCase().includes(q)
    );
  });

  const eligiblePeople = allPeople.filter((p) => p.role !== "NO_ACCESS");

  const inputCls = "border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300";

  return (
    <main className="flex-1 px-4 sm:px-6 py-5 max-w-5xl mx-auto w-full flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}>
            AI Quota Grants
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Grant extra AI requests to users who have hit their rate limit.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-600 select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
            Show expired / exhausted
          </label>
          <button
            onClick={() => { setShowGrantForm(true); setGrantEmployeeId(""); setGrantNote(""); setGrantType("chat"); setGrantExtraRequests(20); setGrantExpiresHours(24); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-sm text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.03em" }}
          >
            <Plus size={14} /> New Grant
          </button>
        </div>
      </div>

      {/* New grant form */}
      {showGrantForm && (
        <div className="bg-white rounded-xl shadow-sm p-5 flex flex-col gap-4" style={{ border: `2px solid ${NAVY}` }}>
          <div className="flex items-center justify-between">
            <p className="font-bold text-sm" style={{ color: NAVY }}>New Quota Grant</p>
            <button onClick={() => setShowGrantForm(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={16} /></button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* User select */}
            <div className="flex flex-col gap-1 sm:col-span-3">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">User</label>
              <select
                className={`${inputCls} py-2`}
                value={grantEmployeeId}
                onChange={(e) => setGrantEmployeeId(e.target.value)}
              >
                <option value="">— Select a user —</option>
                {eligiblePeople.map((p) => (
                  <option key={p.employeeId} value={p.employeeId}>
                    {p.name} ({p.email})
                  </option>
                ))}
              </select>
            </div>

            {/* Type */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</label>
              <select
                className={inputCls}
                value={grantType}
                onChange={(e) => setGrantType(e.target.value as AIQuotaGrantType)}
              >
                <option value="chat">Chat (bypasses 20/15 min)</option>
                <option value="generation">Generation (bypasses 10/15 min)</option>
                <option value="all">All AI (bypasses both)</option>
              </select>
            </div>

            {/* Extra requests */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Extra Requests</label>
              <input
                type="number"
                min={1}
                max={500}
                className={inputCls}
                value={grantExtraRequests}
                onChange={(e) => setGrantExtraRequests(Math.max(1, Math.min(500, Number(e.target.value))))}
              />
            </div>

            {/* Expiry */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Expires In</label>
              <select
                className={inputCls}
                value={grantExpiresHours}
                onChange={(e) => setGrantExpiresHours(Number(e.target.value))}
              >
                <option value={4}>4 hours</option>
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
                <option value={168}>7 days</option>
              </select>
            </div>

            {/* Note */}
            <div className="flex flex-col gap-1 sm:col-span-3">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note (optional)</label>
              <input
                type="text"
                maxLength={120}
                className={inputCls}
                placeholder="e.g. End-of-quarter review"
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowGrantForm(false)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!grantEmployeeId || createMut.isPending}
              className="px-5 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY }}
            >
              {createMut.isPending ? "Granting…" : "Grant Access"}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Grants table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <div className="px-4 py-2.5" style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}>
          <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}>
            {showAll ? "All Grants" : "Active Grants"}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="inline-block w-8 h-8 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Zap size={32} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-400 text-sm font-medium">
              {search
                ? "No grants match your search."
                : showAll
                ? "No grants on record."
                : "No active grants right now."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Used / Total</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Expires</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Note</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((g) => {
                  const isExpiredOrExhausted =
                    new Date(g.expiresAt).getTime() <= now || g.usedRequests >= g.extraRequests;
                  return (
                    <tr
                      key={g.id}
                      className="transition-colors hover:bg-slate-50"
                      style={{ opacity: isExpiredOrExhausted ? 0.55 : 1 }}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-700">
                          {g.personFirstName && g.personLastName
                            ? `${g.personFirstName} ${g.personLastName}`
                            : g.employeeId}
                        </p>
                        {g.personEmail && (
                          <p className="text-xs text-slate-400">{g.personEmail}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-full"
                          style={
                            isExpiredOrExhausted
                              ? { backgroundColor: "#f1f5f9", color: "#64748b" }
                              : { backgroundColor: "#dcfce7", color: "#15803d" }
                          }
                        >
                          {GRANT_LABELS[g.grantType]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 tabular-nums">
                        {g.usedRequests} / {g.extraRequests}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs whitespace-nowrap">
                        {isExpiredOrExhausted
                          ? (g.usedRequests >= g.extraRequests ? "Exhausted" : "Expired")
                          : formatExpiry(g.expiresAt)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs max-w-xs truncate">
                        {g.note ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="text-slate-300 hover:text-red-500 p-1.5 rounded transition-colors disabled:opacity-40"
                          title={isExpiredOrExhausted ? "Remove record" : "Revoke grant"}
                          onClick={() => {
                            const msg = isExpiredOrExhausted
                              ? "Remove this grant record?"
                              : "Revoke this active quota grant?";
                            if (confirm(msg)) revokeMut.mutate(g.id);
                          }}
                          disabled={revokeMut.isPending}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-slate-400 text-center pb-2">
          {filtered.length} grant{filtered.length !== 1 ? "s" : ""} shown
        </p>
      )}
    </main>
  );
}

/* ════════════════════════════════════════════════════════════════
   ADMIN PAGE (root)
   ════════════════════════════════════════════════════════════════ */

type AdminTab = "rubric" | "people" | "schools" | "school-years" | "ai-quota";

export default function AdminPage() {
  const { currentUser, isLoading: userLoading } = useUser();
  const [activeTab, setActiveTab] = useState<AdminTab>("rubric");

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const _adminSearch = new URLSearchParams(window.location.search);
  const returnTo = safeReturnTo(
    _adminSearch.get("returnTo"),
    BASE + "/",
  );
  const schoolAbbreviation = _adminSearch.get("schoolAbbreviation") ?? currentUser?.schoolAbbreviation ?? null;

  /* ── Rubric set management ───────────────────────────────────── */
  const queryClient = useQueryClient();
  const { data: rubricSets = [], isLoading: rubricSetsLoading } = useQuery<RubricSetRow[]>({
    queryKey: ["rubricSets", "all"],
    queryFn: () => fetchRubricSets(true),
    staleTime: 60_000,
  });

  const activeSets   = rubricSets.filter((q) => !q.isArchived);
  const archivedSets = rubricSets.filter((q) => q.isArchived);
  const atLimit      = activeSets.length >= 6;

  const [selectedRubricSetSlug, setSelectedRubricSetSlug] = useState<string>("Q1");
  const [showArchivedSets, setShowArchivedSets]           = useState(false);
  const [editingRubricSet, setEditingRubricSet]           = useState<RubricSetRow | null>(null);
  const dragItem                                          = useRef<string | null>(null);
  const [dragOver, setDragOver]                           = useState<string | null>(null);

  /* Sync selected slug to first active set only if the current slug doesn't exist at all */
  useEffect(() => {
    if (activeSets.length > 0 && !rubricSets.find((q) => q.slug === selectedRubricSetSlug)) {
      setSelectedRubricSetSlug(activeSets[0].slug);
    }
  }, [rubricSets]);

  /* New Rubric Set dialog */
  const [showNewRubricSetDialog, setShowNewRubricSetDialog] = useState(false);
  const [newQName, setNewQName]                     = useState("");
  const [newQGradeSpans, setNewQGradeSpans]         = useState<string[]>([]);
  const [newQTarget, setNewQTarget]                 = useState<"TEACHER" | "SCHOOL">("TEACHER");
  const [newQSubjectAudience, setNewQSubjectAudience] = useState<"STEM" | "HUMANITIES" | "ALL">("ALL");
  const [copyFromSlug, setCopyFromSlug]             = useState<string>("");

  function slugify(s: string) {
    return s.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
  }

  const createQMut = useMutation({
    mutationFn: () => createRubricSet(
      slugify(newQName) || `RS${activeSets.length + 1}`,
      newQName.trim(),
      newQGradeSpans.join(",") || undefined,
      copyFromSlug || undefined,
      newQTarget,
      newQSubjectAudience,
    ),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["rubricSets"] });
      setSelectedRubricSetSlug(created.slug);
      setShowNewRubricSetDialog(false);
      setNewQName("");
      setNewQGradeSpans([]);
      setNewQTarget("TEACHER");
      setNewQSubjectAudience("ALL");
      setCopyFromSlug("");
    },
  });

  const reorderMut = useMutation({
    mutationFn: (items: { slug: string; displayOrder: number }[]) => reorderRubricSets(items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rubricSets"] });
    },
  });

  function moveRubricSet(slug: string, direction: "left" | "right") {
    const idx = activeSets.findIndex((q) => q.slug === slug);
    if (idx < 0) return;
    const swapIdx = direction === "left" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= activeSets.length) return;
    const a = activeSets[idx];
    const b = activeSets[swapIdx];
    const newOrderA = b.displayOrder !== a.displayOrder ? b.displayOrder : (direction === "left" ? a.displayOrder - 1 : a.displayOrder + 1);
    const newOrderB = a.displayOrder;
    reorderMut.mutate([
      { slug: a.slug, displayOrder: newOrderA },
      { slug: b.slug, displayOrder: newOrderB },
    ]);
  }

  if (userLoading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
      </div>
    );
  }

  if (!currentUser || currentUser.role === "COACH") {
    return (
      <div className="h-full overflow-y-auto flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>
        <div style={{ height: 5, backgroundColor: YELLOW }} />
        <header style={{ backgroundColor: NAVY }} className="shadow-md">
          <div className="px-4 sm:px-6 py-3 flex items-center gap-4">
            <a href={returnTo} className="flex items-center gap-2 font-semibold hover:opacity-80" style={{ color: YELLOW, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.02em" }}>
              <ArrowLeft size={18} /> Dashboard
            </a>
          </div>
          <div style={{ height: 3, backgroundColor: YELLOW }} />
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
          <ShieldOff size={48} className="text-slate-300" />
          <h2 className="text-2xl font-bold text-slate-700" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}>
            Access Restricted
          </h2>
          <p className="text-slate-500 max-w-sm">
            Coaches do not have access to the Admin panel. Switch to a School Leader, Network Leader, or Super Admin account to manage settings.
          </p>
          <a
            href={returnTo}
            className="mt-2 px-6 py-2 rounded-lg font-bold text-white"
            style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.03em" }}
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  const isNetworkAdmin   = currentUser?.role === "NETWORK_ADMIN";
  const isNetworkLeader  = currentUser?.role === "NETWORK_LEADER";
  const canManagePeople  = isNetworkAdmin || isNetworkLeader || currentUser?.role === "SCHOOL_LEADER";
  const canBulkImport    = currentUser?.role === "NETWORK_ADMIN";

  const tabs: { id: AdminTab; label: string }[] = [
    ...(isNetworkAdmin ? [{ id: "rubric" as AdminTab,        label: "Rubric Settings" }] : []),
    ...(canManagePeople ? [{ id: "people" as AdminTab,        label: "Users" }]           : []),
    ...(isNetworkAdmin ? [{ id: "schools" as AdminTab,       label: "Schools" }]          : []),
    ...(isNetworkAdmin ? [{ id: "school-years" as AdminTab,  label: "School Years" }]     : []),
    ...(isNetworkAdmin ? [{ id: "ai-quota" as AdminTab,      label: "AI Quota" }]         : []),
  ];

  const defaultTab: AdminTab = canManagePeople ? "people" : "rubric";
  const visibleTab: AdminTab =
    (activeTab === "rubric"       && !isNetworkAdmin)   ? defaultTab :
    (activeTab === "people"       && !canManagePeople)  ? defaultTab :
    (activeTab === "schools"      && !isNetworkAdmin)   ? defaultTab :
    (activeTab === "school-years" && !isNetworkAdmin)   ? defaultTab :
    (activeTab === "ai-quota"     && !isNetworkAdmin)   ? defaultTab :
    activeTab;

  return (
    <div
      className="h-full overflow-y-auto flex flex-col"
      style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}
    >

      {/* ── Sticky header + tab bar ── */}
      <div className="sticky top-0 z-30 shadow-md">
        <AppHeader
          subtitle="Settings"
          basePath={import.meta.env.BASE_URL.replace(/\/$/, "")}
          backHref={returnTo}
          backLabel="Dashboard"
          schoolAbbreviation={schoolAbbreviation}
          userName={currentUser.name}
          userRole={currentUser.role}
          canAdmin={true}
        />

        {/* Tab bar */}
        <div className="bg-white border-b border-slate-200">
        <div className="px-4 sm:px-6 flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-5 py-3 text-sm font-semibold transition-colors relative"
              style={visibleTab === tab.id
                ? { color: NAVY, borderBottom: `3px solid ${NAVY}` }
                : { color: "#64748b", borderBottom: "3px solid transparent" }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* ── Rubric tab: two-column sidebar layout ── */}
      {visibleTab === "rubric" && isNetworkAdmin && (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left sidebar */}
          <div
            className="flex flex-col bg-white shrink-0"
            style={{ width: 252, borderRight: "1px solid #e2e8f0", overflowY: "auto" }}
          >
            {/* Sidebar header */}
            <div className="px-4 pt-3 pb-1" style={{ borderBottom: `2px solid ${YELLOW}` }}>
              <span className="font-bold uppercase" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}>
                List of Rubrics
              </span>
            </div>

            {/* Active rubric list */}
            {rubricSetsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="inline-block w-6 h-6 rounded-full border-2 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
              </div>
            ) : (
              <div className="flex flex-col py-1">
                {activeSets.map((q) => {
                  const selected    = q.slug === selectedRubricSetSlug;
                  const isDragTarget = dragOver === q.slug;
                  return (
                    <div
                      key={q.slug}
                      draggable
                      onDragStart={(e) => {
                        dragItem.current = q.slug;
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOver !== q.slug) setDragOver(q.slug);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromSlug = dragItem.current;
                        dragItem.current = null;
                        setDragOver(null);
                        if (!fromSlug || fromSlug === q.slug) return;
                        const fromIdx = activeSets.findIndex((s) => s.slug === fromSlug);
                        const toIdx   = activeSets.findIndex((s) => s.slug === q.slug);
                        if (fromIdx < 0 || toIdx < 0) return;
                        const reordered = [...activeSets];
                        const [moved]   = reordered.splice(fromIdx, 1);
                        reordered.splice(toIdx, 0, moved);
                        reorderMut.mutate(reordered.map((s, i) => ({ slug: s.slug, displayOrder: i })));
                      }}
                      onDragEnd={() => { setDragOver(null); dragItem.current = null; }}
                      className="group flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors"
                      style={{
                        backgroundColor: selected ? NAVY : isDragTarget ? "#e8eeff" : "transparent",
                        borderLeft: `3px solid ${selected ? YELLOW : isDragTarget ? NAVY : "transparent"}`,
                        opacity: reorderMut.isPending ? 0.7 : 1,
                      }}
                      onClick={() => setSelectedRubricSetSlug(q.slug)}
                    >
                      <GripVertical
                        size={13}
                        className="shrink-0 opacity-0 group-hover:opacity-40 transition-opacity"
                        style={{ color: selected ? "rgba(255,255,255,0.5)" : "#94a3b8", cursor: "grab" }}
                      />
                      <span className="shrink-0" style={{ color: selected ? YELLOW : NAVY }}>
                        <RubricIcon target={q.target} subjectAudience={q.subjectAudience} size={13} />
                      </span>
                      <span
                        className="flex-1 min-w-0 truncate font-bold"
                        style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.03em", color: selected ? "white" : NAVY }}
                      >
                        {q.name}
                        {q.gradeSpan && (
                          <span className="ml-1 font-normal" style={{ fontSize: 11, opacity: 0.6 }}>
                            {q.gradeSpan.split(",").filter(Boolean).join(", ")}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: selected ? "rgba(255,255,255,0.7)" : "#64748b" }}
                        title="Edit settings"
                        onClick={(e) => { e.stopPropagation(); setEditingRubricSet(q); }}
                      >
                        <Settings2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Archived rubric sets */}
            {archivedSets.length > 0 && (
              <div className="border-t border-slate-100 mt-1">
                <button
                  type="button"
                  onClick={() => setShowArchivedSets((v) => !v)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                >
                  <Archive size={11} className="text-slate-400 shrink-0" />
                  <span className="flex-1 text-slate-400 font-bold uppercase" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: "0.05em" }}>
                    Archived ({archivedSets.length})
                  </span>
                  <ChevronDown size={12} className="text-slate-300 shrink-0 transition-transform" style={{ transform: showArchivedSets ? "rotate(180deg)" : "none" }} />
                </button>
                {showArchivedSets && archivedSets.map((q) => {
                  const selected = q.slug === selectedRubricSetSlug;
                  return (
                    <div
                      key={q.slug}
                      className="group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
                      style={{
                        backgroundColor: selected ? "#f1f5f9" : "transparent",
                        borderLeft: `3px solid ${selected ? "#94a3b8" : "transparent"}`,
                      }}
                      onClick={() => setSelectedRubricSetSlug(q.slug)}
                    >
                      <span className="shrink-0 text-slate-300">
                        <RubricIcon target={q.target} subjectAudience={q.subjectAudience} size={13} />
                      </span>
                      <span className="flex-1 min-w-0 truncate font-bold text-slate-400" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}>
                        {q.name}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                        title="Edit settings"
                        onClick={(e) => { e.stopPropagation(); setEditingRubricSet(q); }}
                      >
                        <Settings2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* New Rubric Set button */}
            <div className="mt-auto p-3 border-t border-slate-100">
              {atLimit && !rubricSetsLoading && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded mb-2 text-center">
                  6/6 max — archive a set to add more
                </p>
              )}
              <button
                onClick={() => { if (!atLimit) { setShowNewRubricSetDialog(true); setNewQName(""); setNewQGradeSpans([]); setNewQTarget("TEACHER"); setNewQSubjectAudience("ALL"); setCopyFromSlug(""); } }}
                disabled={atLimit || rubricSetsLoading}
                className="flex items-center justify-center gap-1.5 w-full font-bold rounded-md px-3 py-2 text-sm transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.04em" }}
              >
                <Plus size={15} />
                New Rubric
              </button>
            </div>
          </div>

          {/* Right content panel */}
          <div className="flex-1 overflow-y-auto px-6 py-5" style={{ backgroundColor: "#F4F6FB" }}>
            <div className="max-w-3xl">
              <RubricSettings setSlug={selectedRubricSetSlug} />
            </div>
          </div>
        </div>
      )}

      {/* ── Rubric Set edit dialog ── */}
      {editingRubricSet && (
        <RubricSetEditDialog
          slug={editingRubricSet.slug}
          rubricSet={editingRubricSet}
          onClose={() => setEditingRubricSet(null)}
        />
      )}

      {/* ── People and Schools tabs ── */}
      {visibleTab === "people"       && canManagePeople && <PeopleManagement isNetworkAdmin={isNetworkAdmin} canBulkImport={canBulkImport} canWrite={canManagePeople} />}
      {visibleTab === "schools"      && isNetworkAdmin  && (
        <main className="flex-1 px-4 sm:px-6 py-5 max-w-4xl mx-auto w-full flex flex-col gap-5">
          <SchoolSettings />
        </main>
      )}
      {visibleTab === "school-years" && isNetworkAdmin  && (
        <AdminSchoolYearsTab onGoToUsers={() => setActiveTab("people")} />
      )}
      {visibleTab === "ai-quota"     && isNetworkAdmin  && <AIQuotaTab />}

      {/* ── New Rubric Set dialog ─────────────────────────────── */}
      {showNewRubricSetDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewRubricSetDialog(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between" style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}>
              <h2 className="text-white font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}>
                New Rubric Set
              </h2>
              <button onClick={() => setShowNewRubricSetDialog(false)} className="text-blue-200 hover:text-white p-1">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">Rubric Set Name</label>
                <input
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="e.g. Quarter 2 or Q2 2026"
                  value={newQName}
                  onChange={(e) => setNewQName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newQName.trim()) createQMut.mutate(); }}
                  autoFocus
                />
                {newQName.trim() && (
                  <p className="text-xs text-slate-400">
                    Slug: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{slugify(newQName) || `RS${rubricSets.length + 1}`}</code>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">Grade Spans (optional)</label>
                <div className="flex items-center gap-4 px-1 py-1">
                  {GRADE_SPANS.map((gs) => (
                    <label key={gs} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 select-none">
                      <input
                        type="checkbox"
                        checked={newQGradeSpans.includes(gs)}
                        onChange={(e) => setNewQGradeSpans((p) =>
                          e.target.checked ? [...p, gs] : p.filter((g) => g !== gs)
                        )}
                        className="accent-blue-600 w-4 h-4"
                      />
                      {gs === "ES" ? "Elementary (ES)" : gs === "MS" ? "Middle (MS)" : "High School (HS)"}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  {newQGradeSpans.length > 0
                    ? `Scoped to: ${newQGradeSpans.join(", ")}`
                    : "Leave unchecked to apply to all grade spans."}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">Rubric Target</label>
                <div className="flex items-center gap-5 px-1 py-1">
                  {(["TEACHER", "SCHOOL"] as const).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 select-none">
                      <input
                        type="radio"
                        name="newQTarget"
                        value={opt}
                        checked={newQTarget === opt}
                        onChange={() => setNewQTarget(opt)}
                        className="accent-blue-600 w-4 h-4"
                      />
                      {opt === "TEACHER" ? "Teacher Rubric" : "School-Wide Rubric"}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  {newQTarget === "SCHOOL"
                    ? "School-Wide rubrics are scored per campus, not per teacher."
                    : "Teacher rubrics are the standard — scored per teacher."}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">Subject Audience</label>
                <div className="flex items-center gap-5 px-1 py-1">
                  {(["ALL", "STEM", "HUMANITIES"] as const).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 select-none">
                      <input
                        type="radio"
                        name="newQSubjectAudience"
                        value={opt}
                        checked={newQSubjectAudience === opt}
                        onChange={() => setNewQSubjectAudience(opt)}
                        className="accent-blue-600 w-4 h-4"
                      />
                      {opt === "ALL" ? "All Subjects" : opt === "STEM" ? "STEM" : "Humanities"}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  {newQSubjectAudience === "STEM"
                    ? "Only shown for teachers in STEM departments."
                    : newQSubjectAudience === "HUMANITIES"
                    ? "Only shown for teachers in Humanities departments."
                    : "Shown for all teachers regardless of department."}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Copy size={14} />
                  Copy Rubric From (optional)
                </label>
                <select
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                  value={copyFromSlug}
                  onChange={(e) => setCopyFromSlug(e.target.value)}
                >
                  <option value="">— Start blank —</option>
                  {rubricSets.map((q) => (
                    <option key={q.slug} value={q.slug}>
                      {q.target === "SCHOOL" ? "🏫 " : "🎓 "}{q.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400">
                  {copyFromSlug
                    ? `All categories and domains from ${rubricSets.find((q) => q.slug === copyFromSlug)?.name} will be copied.`
                    : "The new rubric set will start with no categories or domains."}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex justify-end gap-3">
              <button
                onClick={() => setShowNewRubricSetDialog(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => createQMut.mutate()}
                disabled={!newQName.trim() || createQMut.isPending}
                className="px-5 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
              >
                {createQMut.isPending ? "Creating…" : "Create Rubric Set"}
              </button>
            </div>
          </div>
        </div>
      )}

      {visibleTab !== "rubric" && (
        <footer className="text-center pt-1 pb-4" style={{ color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
          &copy; {new Date().getFullYear()} Uncommon Schools, Inc. All rights reserved. | This site is in beta and may have bugs. Share feedback and ideas by completing <a href="https://docs.google.com/forms/d/e/1FAIpQLScGsGBwHNyxAv1jcKYR5Q85gHbIZpUojwVW9PxrgJm7zv20jw/viewform?usp=header" target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", fontWeight: 600 }}>this form</a>.
        </footer>
      )}
    </div>
  );
}

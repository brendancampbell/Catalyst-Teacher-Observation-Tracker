import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, UserCheck, UserX, ShieldOff, ChevronDown, ChevronLeft, ChevronRight, Copy, School, Users, Upload, Download, FileText, AlertCircle, CheckCircle2, SkipForward, Archive, ArchiveRestore, Search } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import {
  fetchRubric,
  fetchRubricSets,
  createRubricSet,
  updateRubricSet,
  archiveRubricSet,
  reorderRubricSets,
  createCategory,
  updateCategory,
  deleteCategory,
  createDomain,
  updateDomain,
  deleteDomain,
  fetchAdminTeachers,
  createAdminTeacher,
  updateAdminTeacher,
  toggleTeacherActive,
  fetchAdminSchools,
  createAdminSchool,
  updateAdminSchool,
  deleteAdminSchool,
  fetchUsers,
  createUser,
  updateUser,
  bulkImportUsers,
  bulkImportTeachers,
  REGIONS,
  GRADE_SPANS,
  type FullRubric,
  type RubricCategoryRow,
  type RubricDomainRow,
  type RubricSetRow,
  type AdminTeacher,
  type AdminSchool,
  type UserRow,
  type UserRole,
  type BulkImportRowResult,
  type BulkImportUserPayload,
  type BulkImportTeacherPayload,
  type BulkImportTeacherRowResult,
} from "@/lib/api";
import { useUser } from "@/context/UserContext";
import { SUBJECTS, GRADE_LEVELS } from "@/data/dummy";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

/* ════════════════════════════════════════════════════════════════
   RUBRIC SETTINGS TAB
   ════════════════════════════════════════════════════════════════ */

function RubricSettings({ setSlug }: { setSlug: string }) {
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
  const [editingSetName, setEditingSetName] = useState(false);
  const [pendingSetName, setPendingSetName] = useState("");
  const [addingCat,         setAddingCat]         = useState(false);
  const [newCatName,        setNewCatName]        = useState("");
  const [newCatOrder,       setNewCatOrder]       = useState(1);
  const [addingDomForCat,   setAddingDomForCat]   = useState<number | null>(null);
  const [newDomName,        setNewDomName]        = useState("");
  const [newDomSlug,        setNewDomSlug]        = useState("");
  const [newDomOrder,       setNewDomOrder]       = useState(1);
  const [newDomDesc,        setNewDomDesc]        = useState("");

  const archiveSetMut = useMutation({
    mutationFn: (archive: boolean) => archiveRubricSet(setSlug, archive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      queryClient.invalidateQueries({ queryKey: ["rubricSets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const renameSetMut = useMutation({
    mutationFn: (name: string) => updateRubricSet(setSlug, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      queryClient.invalidateQueries({ queryKey: ["rubricSets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setEditingSetName(false);
    },
  });

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
  });

  const addDomMut = useMutation({
    mutationFn: ({ catId, name, slug, order, desc }: { catId: number; name: string; slug: string; order: number; desc: string }) =>
      createDomain(catId, name, slug, order, desc || undefined),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setAddingDomForCat(null); setNewDomName(""); setNewDomSlug(""); setNewDomOrder(1); setNewDomDesc(""); },
  });

  const updDomMut = useMutation({
    mutationFn: ({ id, name, slug, description }: { id: number; name: string; slug: string; description: string }) =>
      updateDomain(id, name, slug, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setEditingDomId(null);
    },
  });

  const delDomMut = useMutation({
    mutationFn: (id: number) => deleteDomain(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  function startEditCat(cat: RubricCategoryRow) {
    setEditingCatId(cat.id); setEditingCatName(cat.name); setEditingDomId(null);
  }

  function startEditDom(dom: RubricDomainRow) {
    setEditingDomId(dom.id); setEditingDomName(dom.name); setEditingDomSlug(dom.slug);
    setEditingDomDesc(dom.description ?? ""); setEditingCatId(null);
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
      <div className="flex items-center gap-3 flex-wrap">
        {editingSetName ? (
          <div className="flex items-center gap-2">
            <input
              className="px-3 py-1.5 rounded border border-blue-300 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.03em", minWidth: 140 }}
              value={pendingSetName}
              onChange={(e) => setPendingSetName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && pendingSetName.trim()) renameSetMut.mutate(pendingSetName.trim());
                if (e.key === "Escape") setEditingSetName(false);
              }}
            />
            <button
              className="text-green-600 hover:text-green-800 p-1 disabled:opacity-50"
              disabled={!pendingSetName.trim() || renameSetMut.isPending}
              onClick={() => renameSetMut.mutate(pendingSetName.trim())}
            >
              <Check size={16} />
            </button>
            <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setEditingSetName(false)}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className="px-4 py-1.5 rounded-full font-bold uppercase text-white shrink-0"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.03em" }}
            >
              {data.rubricSet.name}
            </span>
            <button
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-slate-500 border border-slate-200 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              title="Rename rubric set"
              onClick={() => { setPendingSetName(data.rubricSet.name); setEditingSetName(true); }}
            >
              <Pencil size={11} />
              Rename
            </button>
          </div>
        )}

        {data.rubricSet.isArchived && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-200 uppercase tracking-wide">
            Archived
          </span>
        )}

        <div className="ml-auto">
          {data.rubricSet.isArchived ? (
            <button
              disabled={archiveSetMut.isPending}
              onClick={() => archiveSetMut.mutate(false)}
              className="flex items-center gap-1.5 font-semibold rounded-md px-3 py-1.5 text-sm border transition-colors hover:bg-green-50 disabled:opacity-50"
              style={{ borderColor: "#16a34a", color: "#16a34a" }}
            >
              <ArchiveRestore size={14} />
              Restore to Active
            </button>
          ) : (
            <button
              disabled={archiveSetMut.isPending}
              onClick={() => { if (confirm(`Archive "${data.rubricSet.name}"? It will be hidden from the dashboard until restored.`)) archiveSetMut.mutate(true); }}
              className="flex items-center gap-1.5 font-semibold rounded-md px-3 py-1.5 text-sm border transition-colors hover:bg-amber-50 disabled:opacity-50"
              style={{ borderColor: "#d97706", color: "#d97706" }}
            >
              <Archive size={14} />
              Archive
            </button>
          )}
        </div>
      </div>

      {data.categories.map((cat) => (
        <div key={cat.id} className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
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
                <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.02em" }}>{cat.name}</span>
                <div className="flex items-center gap-1">
                  <button className="text-blue-300 hover:text-white p-1.5 rounded" onClick={() => startEditCat(cat)}><Pencil size={14} /></button>
                  <button className="text-red-400 hover:text-red-200 p-1.5 rounded" onClick={() => { if (confirm(`Delete category "${cat.name}" and all its domains?`)) delCatMut.mutate(cat.id); }}><Trash2 size={14} /></button>
                </div>
              </>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            {cat.domains.map((dom) => (
              <div key={dom.id} className="px-4 py-2.5 hover:bg-slate-50 transition-colors">
                {editingDomId === dom.id ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <input className={`${inputCls} flex-1`} value={editingDomName} onChange={(e) => setEditingDomName(e.target.value)} placeholder="Domain name" autoFocus onKeyDown={(e) => { if (e.key === "Escape") setEditingDomId(null); }} />
                      <input className={`${inputCls} w-36`} value={editingDomSlug} onChange={(e) => setEditingDomSlug(e.target.value)} placeholder="slug" onKeyDown={(e) => { if (e.key === "Escape") setEditingDomId(null); }} />
                      <button className="text-green-600 hover:text-green-800 p-1 shrink-0" onClick={() => updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug, description: editingDomDesc })} disabled={updDomMut.isPending}><Check size={16} /></button>
                      <button className="text-slate-400 hover:text-slate-600 p-1 shrink-0" onClick={() => setEditingDomId(null)}><X size={16} /></button>
                    </div>
                    <input
                      className={`${inputCls} w-full text-xs`}
                      value={editingDomDesc}
                      onChange={(e) => setEditingDomDesc(e.target.value)}
                      placeholder="Hover tooltip text — describe what this domain measures…"
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingDomId(null); }}
                    />
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-700 text-sm">{dom.name}</span>
                        <code className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded font-mono shrink-0">{dom.slug}</code>
                      </div>
                      {dom.description && (
                        <p className="text-xs text-slate-400 mt-0.5 leading-snug line-clamp-2">{dom.description}</p>
                      )}
                    </div>
                    <button className="text-slate-400 hover:text-blue-600 p-1.5 rounded shrink-0" onClick={() => startEditDom(dom)}><Pencil size={13} /></button>
                    <button className="text-slate-400 hover:text-red-500 p-1.5 rounded shrink-0" onClick={() => { if (confirm(`Delete domain "${dom.name}"?`)) delDomMut.mutate(dom.id); }}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}

            {addingDomForCat === cat.id ? (
              <div className="flex flex-col gap-2 px-4 py-2.5 bg-blue-50">
                <div className="flex items-center gap-2 flex-wrap">
                  <input className={`${inputCls} flex-1 min-w-32`} value={newDomName} onChange={(e) => { setNewDomName(e.target.value); setNewDomSlug(slugify(e.target.value)); }} placeholder="Domain name" autoFocus />
                  <input className={`${inputCls} w-36`} value={newDomSlug} onChange={(e) => setNewDomSlug(e.target.value)} placeholder="slug" />
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
                  <button className="text-slate-400 hover:text-slate-600 p-1 shrink-0" onClick={() => { setAddingDomForCat(null); setNewDomName(""); setNewDomSlug(""); setNewDomOrder(1); setNewDomDesc(""); }}><X size={16} /></button>
                </div>
                <textarea
                  className={`${inputCls} w-full text-xs resize-none`}
                  rows={2}
                  value={newDomDesc}
                  onChange={(e) => setNewDomDesc(e.target.value)}
                  placeholder="Hover tooltip text — describe what this domain measures… (optional)"
                />
              </div>
            ) : (
              <button className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold hover:bg-slate-50" style={{ color: NAVY }} onClick={() => { setAddingDomForCat(cat.id); setNewDomName(""); setNewDomSlug(""); setNewDomOrder(cat.domains.length + 1); }}>
                <Plus size={13} />Add domain
              </button>
            )}
          </div>
        </div>
      ))}

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
   TEACHER ROSTER TAB
   ════════════════════════════════════════════════════════════════ */

function TeacherRoster({ isDistrictAdmin, canBulkImport }: { isDistrictAdmin: boolean; canBulkImport: boolean }) {
  const queryClient = useQueryClient();
  const qKey = ["admin", "teachers"] as const;
  const [rosterView, setRosterView] = useState<"list" | "bulk">("list");

  const { data: teachers = [], isLoading } = useQuery<AdminTeacher[]>({
    queryKey: qKey,
    queryFn: fetchAdminTeachers,
  });

  const { data: schools = [] } = useQuery<AdminSchool[]>({
    queryKey: ["admin", "schools"],
    queryFn: fetchAdminSchools,
    enabled: isDistrictAdmin,
  });

  /* Add form */
  const [adding, setAdding]               = useState(false);
  const [newName, setNewName]             = useState("");
  const [newSubject, setNewSubject]       = useState("");
  const [newGrades, setNewGrades]         = useState<string[]>([]);
  const [newSchoolId, setNewSchoolId]     = useState<number | null>(null);

  /* Edit form */
  const [editId, setEditId]               = useState<number | null>(null);
  const [editName, setEditName]           = useState("");
  const [editSubject, setEditSubject]     = useState("");
  const [editGrades, setEditGrades]       = useState<string[]>([]);
  const [editSchoolId, setEditSchoolId]   = useState<number | null>(null);

  const [showInactive,   setShowInactive]   = useState(false);
  const [teacherSearch,  setTeacherSearch]  = useState("");
  const [filterSubjects, setFilterSubjects] = useState<string[]>([]);
  const [filterSchools,  setFilterSchools]  = useState<string[]>([]);

  const createMut = useMutation({
    mutationFn: () => createAdminTeacher({ name: newName.trim(), subject: newSubject, gradeLevel: newGrades, schoolId: newSchoolId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setAdding(false); setNewName(""); setNewSubject(""); setNewGrades([]); setNewSchoolId(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: () => updateAdminTeacher(editId!, { name: editName.trim(), subject: editSubject, gradeLevel: editGrades, schoolId: editSchoolId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setEditId(null); },
  });

  const toggleMut = useMutation({
    mutationFn: (id: number) => toggleTeacherActive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  function startEdit(t: AdminTeacher) {
    setEditId(t.id); setEditName(t.name); setEditSubject(t.subject);
    setEditGrades(t.gradeLevel); setEditSchoolId(t.schoolId);
  }

  function toggleGrade(g: string, arr: string[], setArr: (v: string[]) => void) {
    setArr(arr.includes(g) ? arr.filter((x) => x !== g) : [...arr, g]);
  }

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  const allSubjects = Array.from(new Set(teachers.map((t) => t.subject).filter(Boolean))).sort();
  const allSchoolOptions = schools.map((s) => s.name);

  const shown = teachers.filter((t) => {
    if (!showInactive && !t.isActive) return false;
    if (teacherSearch) {
      const q = teacherSearch.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.subject.toLowerCase().includes(q)) return false;
    }
    if (filterSubjects.length > 0 && !filterSubjects.includes(t.subject)) return false;
    if (filterSchools.length > 0) {
      const schoolName = schools.find((s) => s.id === t.schoolId)?.name ?? "";
      if (!filterSchools.includes(schoolName)) return false;
    }
    return true;
  });

  const teacherFiltersActive = filterSubjects.length > 0 || filterSchools.length > 0;

  const colSpanTotal = isDistrictAdmin ? 6 : 5;

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
    </div>
  );

  if (rosterView === "bulk" && canBulkImport) {
    return (
      <div className="flex flex-col gap-4">
        {/* Sub-tab bar */}
        <div className="flex gap-1 border-b border-slate-200 pb-0">
          <button
            onClick={() => setRosterView("list")}
            className="px-4 py-2 text-sm font-semibold transition-colors"
            style={{ color: "#64748b", borderBottom: "3px solid transparent" }}
          >
            Roster
          </button>
          <button
            className="px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-1.5"
            style={{ color: NAVY, borderBottom: `3px solid ${NAVY}` }}
          >
            <Upload size={13} />
            Bulk Import
          </button>
        </div>
        <BulkImportTeachers isDistrictAdmin={isDistrictAdmin} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-slate-200 pb-0">
        <button
          className="px-4 py-2 text-sm font-semibold transition-colors"
          style={{ color: NAVY, borderBottom: `3px solid ${NAVY}` }}
        >
          Roster
        </button>
        {canBulkImport && (
          <button
            onClick={() => setRosterView("bulk")}
            className="px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-1.5"
            style={{ color: "#64748b", borderBottom: "3px solid transparent" }}
          >
            <Upload size={13} />
            Bulk Import
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="pl-8 pr-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white w-52"
            placeholder="Search name or subject…"
            value={teacherSearch}
            onChange={(e) => setTeacherSearch(e.target.value)}
          />
          {teacherSearch && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setTeacherSearch("")}><X size={12} /></button>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} />

        {/* Filters label */}
        <span className="font-bold uppercase tracking-widest shrink-0" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}>
          Filters
        </span>

        {allSubjects.length > 0 && (
          <FilterMultiSelect label="Subject" values={filterSubjects} onChange={setFilterSubjects} options={allSubjects} />
        )}
        {isDistrictAdmin && allSchoolOptions.length > 0 && (
          <FilterMultiSelect label="School" values={filterSchools} onChange={setFilterSchools} options={allSchoolOptions} />
        )}
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-blue-700" />
          Show inactive
        </label>
        {(teacherFiltersActive || teacherSearch) && (
          <button
            onClick={() => { setFilterSubjects([]); setFilterSchools([]); setTeacherSearch(""); }}
            className="font-semibold underline underline-offset-2 text-sm"
            style={{ color: NAVY }}
          >
            Clear all
          </button>
        )}

        {/* Add button — pushed to far right */}
        <div className="ml-auto">
          <button
            onClick={() => { setAdding(true); setEditId(null); }}
            className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90 shrink-0"
            style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
          >
            <Plus size={14} />
            Add Teacher
          </button>
        </div>
      </div>

      {/* Add teacher form */}
      {adding && (
        <TeacherForm
          title="Add New Teacher"
          name={newName} setName={setNewName}
          subject={newSubject} setSubject={setNewSubject}
          grades={newGrades}
          onToggleGrade={(g) => toggleGrade(g, newGrades, setNewGrades)}
          schools={isDistrictAdmin ? schools : null}
          schoolId={newSchoolId} setSchoolId={setNewSchoolId}
          onSave={() => createMut.mutate()}
          onCancel={() => { setAdding(false); setNewName(""); setNewSubject(""); setNewGrades([]); setNewSchoolId(null); }}
          saving={createMut.isPending}
          inputCls={inputCls}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: NAVY, color: "white" }}>
              <th className="text-left px-4 py-2.5 font-semibold" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>Name</th>
              <th className="text-left px-4 py-2.5 font-semibold hidden sm:table-cell" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>Subject</th>
              <th className="text-left px-4 py-2.5 font-semibold hidden md:table-cell" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>Grades</th>
              {isDistrictAdmin && (
                <th className="text-left px-4 py-2.5 font-semibold hidden lg:table-cell" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>School</th>
              )}
              <th className="text-left px-4 py-2.5 font-semibold" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && (
              <tr><td colSpan={colSpanTotal} className="text-center py-8 text-slate-400">No teachers found.</td></tr>
            )}
            {shown.map((t) => (
              <tr key={t.id}>
                {editId === t.id ? (
                  <td colSpan={colSpanTotal} className="px-4 py-3 bg-blue-50">
                    <TeacherForm
                      title={`Editing: ${t.name}`}
                      name={editName} setName={setEditName}
                      subject={editSubject} setSubject={setEditSubject}
                      grades={editGrades}
                      onToggleGrade={(g) => toggleGrade(g, editGrades, setEditGrades)}
                      schools={isDistrictAdmin ? schools : null}
                      schoolId={editSchoolId} setSchoolId={setEditSchoolId}
                      onSave={() => updateMut.mutate()}
                      onCancel={() => setEditId(null)}
                      saving={updateMut.isPending}
                      inputCls={inputCls}
                      compact
                    />
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-2.5 font-medium text-slate-800" style={{ opacity: t.isActive ? 1 : 0.5 }}>{t.name}</td>
                    <td className="px-4 py-2.5 text-slate-600 hidden sm:table-cell" style={{ opacity: t.isActive ? 1 : 0.5 }}>{t.subject}</td>
                    <td className="px-4 py-2.5 text-slate-500 hidden md:table-cell" style={{ opacity: t.isActive ? 1 : 0.5 }}>
                      {t.gradeLevel.length ? t.gradeLevel.map((g) => `Gr ${g}`).join(", ") : "—"}
                    </td>
                    {isDistrictAdmin && (
                      <td className="px-4 py-2.5 text-slate-500 hidden lg:table-cell" style={{ opacity: t.isActive ? 1 : 0.5 }}>
                        {t.schoolName ?? <span className="text-slate-300 italic">Unassigned</span>}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <span
                        className="text-xs font-bold rounded-full px-2.5 py-1"
                        style={t.isActive
                          ? { backgroundColor: "#dcfce7", color: "#15803d" }
                          : { backgroundColor: "#fee2e2", color: "#b91c1c" }
                        }
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          className="text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors"
                          title="Edit"
                          onClick={() => startEdit(t)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className={`p-1.5 rounded transition-colors ${t.isActive ? "text-slate-400 hover:text-red-500" : "text-slate-400 hover:text-green-600"}`}
                          title={t.isActive ? "Deactivate" : "Reactivate"}
                          onClick={() => toggleMut.mutate(t.id)}
                          disabled={toggleMut.isPending}
                        >
                          {t.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-center text-slate-400 text-xs pb-2">
        Inactive teachers are hidden from the dashboard but their observations are preserved.
      </p>
    </div>
  );
}

/* Shared form component */
function TeacherForm({
  title, name, setName, subject, setSubject, grades, onToggleGrade,
  schools, schoolId, setSchoolId,
  onSave, onCancel, saving, inputCls, compact = false,
}: {
  title: string; name: string; setName: (v: string) => void;
  subject: string; setSubject: (v: string) => void;
  grades: string[]; onToggleGrade: (g: string) => void;
  schools: AdminSchool[] | null;
  schoolId: number | null; setSchoolId: (v: number | null) => void;
  onSave: () => void; onCancel: () => void; saving: boolean;
  inputCls: string; compact?: boolean;
}) {
  return (
    <div className={`bg-white rounded-lg p-4 flex flex-col gap-3 ${compact ? "" : "shadow-sm"}`} style={{ border: `2px solid ${NAVY}` }}>
      {!compact && <p className="font-bold text-slate-700 text-sm">{title}</p>}
      <div className="flex flex-wrap gap-3">
        <input
          className={`${inputCls} flex-1 min-w-[160px]`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoFocus
        />
        <select
          className={`${inputCls} flex-1 min-w-[140px]`}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        >
          <option value="">— Subject —</option>
          {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {schools !== null && (
          <select
            className={`${inputCls} flex-1 min-w-[160px]`}
            value={schoolId ?? ""}
            onChange={(e) => setSchoolId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— School —</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1.5 font-medium">Grade levels:</p>
        <div className="flex flex-wrap gap-1.5">
          {GRADE_LEVELS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onToggleGrade(g)}
              className="px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors"
              style={grades.includes(g)
                ? { backgroundColor: NAVY, color: "white", borderColor: NAVY }
                : { backgroundColor: "white", color: NAVY, borderColor: "#c7d2e8" }
              }
            >
              {g === "K" ? "K" : g}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="px-4 py-1.5 rounded font-bold text-white text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: NAVY }}
          onClick={onSave}
          disabled={saving || !name.trim() || !subject}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="px-4 py-1.5 rounded font-semibold text-slate-600 text-sm hover:bg-slate-100" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   TEACHER BULK IMPORT
   ════════════════════════════════════════════════════════════════ */

const TEACHER_CSV_TEMPLATE = `name,subject,gradeLevel,school
Jane Smith,Math,"K,1,2",Lincoln Elementary
John Doe,ELA,"3,4",Lincoln Elementary
`;

function parseTeacherCSV(text: string): BulkImportTeacherPayload[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const results: BulkImportTeacherPayload[] = [];
  if (lines.length < 2) return results;

  const headers    = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const nameIdx    = headers.indexOf("name");
  const subjectIdx = headers.indexOf("subject");
  const gradeIdx   = headers.indexOf("gradelevel");
  const schoolIdx  = headers.indexOf("school");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    results.push({
      name:       nameIdx    >= 0 ? (cols[nameIdx]    ?? "") : "",
      subject:    subjectIdx >= 0 ? (cols[subjectIdx] ?? "") : "",
      gradeLevel: gradeIdx   >= 0 ? (cols[gradeIdx]   ?? "") : "",
      school:     schoolIdx  >= 0 ? (cols[schoolIdx]  ?? "") : "",
    });
  }
  return results;
}

function downloadTeacherTemplate() {
  const blob = new Blob([TEACHER_CSV_TEMPLATE], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "teacher_import_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function BulkImportTeachers({ isDistrictAdmin }: { isDistrictAdmin: boolean }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview]           = useState<BulkImportTeacherPayload[] | null>(null);
  const [fileName, setFileName]         = useState<string>("");
  const [importResult, setImportResult] = useState<BulkImportTeacherRowResult[] | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);

  function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) { alert("Please upload a .csv file."); return; }
    setFileName(file.name);
    setImportResult(null);
    setSubmitError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setPreview(parseTeacherCSV(text));
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (!preview || preview.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await bulkImportTeachers(preview);
      setImportResult(result.results);
      setPreview(null);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["admin", "teachers"] });
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setPreview(null);
    setFileName("");
    setImportResult(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const created = importResult?.filter((r) => r.status === "created") ?? [];
  const skipped = importResult?.filter((r) => r.status === "skipped") ?? [];
  const errors  = importResult?.filter((r) => r.status === "error")   ?? [];

  return (
    <div className="flex flex-col gap-5">

      {/* Format guide */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
          <FileText size={15} className="text-yellow-300" />
          <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}>
            CSV Format Guide
          </span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            Upload a <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">.csv</code> file with the following columns.
            The first row must be the header row. Column names are case-insensitive.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Column</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Required</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  { col: "name",       req: true,          desc: "Full name of the teacher" },
                  { col: "subject",    req: true,          desc: "Subject area (e.g. Math, ELA, Science)" },
                  { col: "gradeLevel", req: true,          desc: 'Comma-separated grade values within the cell, e.g. "K,1,2"' },
                  { col: "school",     req: isDistrictAdmin, desc: isDistrictAdmin ? "Exact school name (required for Network Admin)" : "School name (ignored — your school is used automatically)" },
                ].map(({ col, req, desc }) => (
                  <tr key={col}>
                    <td className="px-3 py-2"><code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono font-bold">{col}</code></td>
                    <td className="px-3 py-2">
                      {req
                        ? <span className="text-xs font-bold text-red-600">Required</span>
                        : <span className="text-xs text-slate-400">Optional</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={downloadTeacherTemplate}
            className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
          >
            <Download size={14} />
            Download Template
          </button>
        </div>
      </div>

      {/* File picker */}
      {!importResult && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
            <Upload size={15} className="text-yellow-300" />
            <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}>
              Upload CSV
            </span>
          </div>
          <div className="px-4 py-4 flex flex-col gap-3">
            <div
              className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-3 cursor-pointer transition-colors hover:border-blue-400 hover:bg-blue-50"
              style={{ borderColor: "#c7d2e8" }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleFile(file); }}
            >
              <Upload size={28} className="text-slate-300" />
              <p className="text-sm text-slate-500 text-center">
                <span className="font-semibold" style={{ color: NAVY }}>Click to browse</span> or drag and drop a CSV file here
              </p>
              {fileName && (
                <span className="text-xs text-green-700 font-semibold bg-green-100 px-2.5 py-1 rounded-full">{fileName}</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }}
            />
          </div>
        </div>
      )}

      {/* Preview table */}
      {preview && preview.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
          <div className="px-4 py-2.5 flex items-center justify-between gap-2" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
            <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}>
              Preview — {preview.length} row{preview.length !== 1 ? "s" : ""}
            </span>
            <button onClick={resetAll} className="text-blue-300 hover:text-white p-1"><X size={16} /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">#</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Subject</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Grade Level</th>
                  {isDistrictAdmin && (
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">School</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{row.name || <span className="text-red-400 italic">missing</span>}</td>
                    <td className="px-3 py-2 text-slate-600">{row.subject || <span className="text-red-400 italic">missing</span>}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{row.gradeLevel || <span className="text-red-400 italic">missing</span>}</td>
                    {isDistrictAdmin && (
                      <td className="px-3 py-2 text-slate-500 text-xs">{row.school || <span className="text-red-400 italic">missing</span>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {submitError && (
            <div className="px-4 py-3 bg-red-50 border-t border-red-200 flex items-start gap-2 text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              {submitError}
            </div>
          )}
          <div className="px-4 py-3 border-t border-slate-100 flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
            >
              {submitting ? "Importing…" : `Import ${preview.length} Teacher${preview.length !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={resetAll}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Results summary */}
      {importResult && (
        <div className="flex flex-col gap-3">
          <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-4" style={{ border: "1px solid #dde3f0" }}>
            <span className="font-bold text-slate-700 text-sm">Import complete:</span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-green-700">
              <CheckCircle2 size={15} />{created.length} created
            </span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-amber-600">
              <SkipForward size={15} />{skipped.length} skipped
            </span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-red-600">
              <AlertCircle size={15} />{errors.length} error{errors.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={resetAll}
              className="ml-auto px-4 py-1.5 rounded-lg text-sm font-bold text-white hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
            >
              Import Another File
            </button>
          </div>

          {created.length > 0 && (
            <TeacherResultSection
              title={`Created (${created.length})`}
              rows={created}
              headerStyle={{ backgroundColor: "#16a34a" }}
              statusBadge={() => <span className="text-xs font-bold text-green-700 bg-green-100 rounded-full px-2 py-0.5">Created</span>}
            />
          )}
          {skipped.length > 0 && (
            <TeacherResultSection
              title={`Skipped — Duplicate (${skipped.length})`}
              rows={skipped}
              headerStyle={{ backgroundColor: "#d97706" }}
              statusBadge={(r) => <span className="text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">{r.reason ?? "Skipped"}</span>}
            />
          )}
          {errors.length > 0 && (
            <TeacherResultSection
              title={`Errors (${errors.length})`}
              rows={errors}
              headerStyle={{ backgroundColor: "#dc2626" }}
              statusBadge={(r) => <span className="text-xs font-bold text-red-700 bg-red-100 rounded-full px-2 py-0.5">{r.reason ?? "Error"}</span>}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TeacherResultSection({
  title,
  rows,
  headerStyle,
  statusBadge,
}: {
  title: string;
  rows: BulkImportTeacherRowResult[];
  headerStyle: React.CSSProperties;
  statusBadge: (r: BulkImportTeacherRowResult) => React.ReactNode;
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
            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.row}>
              <td className="px-3 py-2 text-slate-400 text-xs">{r.row}</td>
              <td className="px-3 py-2 font-medium text-slate-800">{r.name ?? "—"}</td>
              <td className="px-3 py-2">{statusBadge(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function SchoolSettings() {
  const queryClient = useQueryClient();
  const qKey = ["admin", "schools"] as const;

  const { data: schools = [], isLoading } = useQuery<AdminSchool[]>({
    queryKey: qKey,
    queryFn: fetchAdminSchools,
  });

  /* Add form */
  const [adding, setAdding]           = useState(false);
  const [newName, setNewName]         = useState("");
  const [newRegion, setNewRegion]     = useState("");
  const [newSpan, setNewSpan]         = useState("");

  /* Edit form */
  const [editId, setEditId]           = useState<number | null>(null);
  const [editName, setEditName]       = useState("");
  const [editRegion, setEditRegion]   = useState("");
  const [editSpan, setEditSpan]       = useState("");

  /* Filters */
  const [schoolSearch,    setSchoolSearch]    = useState("");
  const [filterRegions,   setFilterRegions]   = useState<string[]>([]);
  const [filterGradeSpans, setFilterGradeSpans] = useState<string[]>([]);

  function resetAdd() { setAdding(false); setNewName(""); setNewRegion(""); setNewSpan(""); }
  function resetEdit() { setEditId(null); }

  const createMut = useMutation({
    mutationFn: () => createAdminSchool({ name: newName.trim(), region: newRegion, gradeSpan: newSpan }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); resetAdd(); },
  });

  const updateMut = useMutation({
    mutationFn: () => updateAdminSchool(editId!, { name: editName.trim(), region: editRegion, gradeSpan: editSpan }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); resetEdit(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAdminSchool(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
    onError: (err: Error) => alert(err.message),
  });

  function startEdit(s: AdminSchool) {
    setEditId(s.id); setEditName(s.name);
    setEditRegion(s.region ?? ""); setEditSpan(s.gradeSpan ?? "");
    setAdding(false);
  }

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";
  const selCls   = `${inputCls} cursor-pointer`;

  const schoolFiltersActive = filterRegions.length > 0 || filterGradeSpans.length > 0;

  const shownSchools = schools.filter((s) => {
    if (schoolSearch && !s.name.toLowerCase().includes(schoolSearch.toLowerCase())) return false;
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

        <div className="ml-auto">
          <button
            onClick={() => { setAdding(true); setEditId(null); setNewName(""); setNewRegion(""); setNewSpan(""); }}
            className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90 shrink-0"
            style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
          >
            <Plus size={14} />
            Add School
          </button>
        </div>
      </div>

      {/* Add school form */}
      {adding && (
        <div className="bg-white rounded-lg p-4 flex flex-col gap-3 shadow-sm" style={{ border: `2px solid ${NAVY}` }}>
          <div className="flex flex-wrap gap-3">
            <input
              className={`${inputCls} flex-1 min-w-[200px]`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="School name (e.g. Lincoln Middle School)"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Escape") resetAdd(); }}
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
              disabled={createMut.isPending || !newName.trim() || !newRegion || !newSpan}
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
        <ul className="divide-y divide-slate-100">
          {shownSchools.map((school) => (
            <li key={school.id}>
              {editId === school.id ? (
                /* ── Inline edit form ── */
                <div className="px-4 py-3 bg-blue-50 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-3">
                    <input
                      className={`${inputCls} flex-1 min-w-[200px]`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Escape") resetEdit(); }}
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
                      disabled={updateMut.isPending || !editName.trim() || !editRegion || !editSpan}
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
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <School size={16} className="text-slate-300 shrink-0" />
                  <span className="flex-1 font-medium text-slate-700 text-sm">{school.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {school.region && (
                      <span
                        className="text-xs font-bold rounded-full px-2.5 py-0.5"
                        style={{
                          backgroundColor: (REGION_COLORS[school.region] ?? { bg: "#f1f5f9" }).bg,
                          color: (REGION_COLORS[school.region] ?? { color: "#475569" }).color,
                        }}
                      >
                        {school.region}
                      </span>
                    )}
                    {school.gradeSpan && (
                      <span
                        className="text-xs font-bold rounded-full px-2.5 py-0.5"
                        style={{
                          backgroundColor: (GRADE_SPAN_COLORS[school.gradeSpan] ?? { bg: "#f1f5f9" }).bg,
                          color: (GRADE_SPAN_COLORS[school.gradeSpan] ?? { color: "#475569" }).color,
                        }}
                      >
                        {school.gradeSpan}
                      </span>
                    )}
                  </div>
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
                    onClick={() => { if (confirm(`Delete "${school.name}"? This will fail if teachers are still assigned to it.`)) deleteMut.mutate(school.id); }}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 size={13} />
                  </button>
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
   USER MANAGEMENT TAB
   ════════════════════════════════════════════════════════════════ */

const ALL_ROLES_MAP: Record<UserRole, string> = {
  COACH: "Coach",
  SCHOOL_LEADER: "School Leader",
  NETWORK_LEADER: "Network Leader",
  NETWORK_ADMIN: "Network Admin",
};

function UserManagement({ isNetworkAdmin, currentUserSchoolId, canBulkImport }: { isNetworkAdmin: boolean; currentUserSchoolId: number | null; canBulkImport: boolean }) {
  const queryClient = useQueryClient();
  const qKey = ["admin", "users"] as const;
  const [userView, setUserView] = useState<"list" | "bulk">("list");

  const { data: userList = [], isLoading } = useQuery<UserRow[]>({
    queryKey: qKey,
    queryFn: fetchUsers,
  });

  const { data: schools = [] } = useQuery<AdminSchool[]>({
    queryKey: ["admin", "schools"],
    queryFn: fetchAdminSchools,
    enabled: isNetworkAdmin,
  });

  const [adding, setAdding]     = useState(false);
  const [editId, setEditId]     = useState<number | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newName,  setNewName]  = useState("");
  const [newRole,  setNewRole]  = useState<UserRole>("COACH");
  const [newSchoolId, setNewSchoolId] = useState<number | null>(null);

  const [editEmail, setEditEmail] = useState("");
  const [editName,  setEditName]  = useState("");
  const [editRole,  setEditRole]  = useState<UserRole>("COACH");
  const [editSchoolId, setEditSchoolId] = useState<number | null>(null);

  /* Filters */
  const [userSearch,    setUserSearch]    = useState("");
  const [filterRoles,   setFilterRoles]   = useState<string[]>([]);
  const [filterUserSchools, setFilterUserSchools] = useState<string[]>([]);

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";
  const selCls   = `${inputCls} cursor-pointer`;

  const availableRoles: UserRole[] = isNetworkAdmin
    ? ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"]
    : ["COACH", "SCHOOL_LEADER"];

  const createMut = useMutation({
    mutationFn: () => createUser({ email: newEmail.trim(), name: newName.trim(), role: newRole, schoolId: newSchoolId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qKey });
      setAdding(false); setNewEmail(""); setNewName(""); setNewRole("COACH"); setNewSchoolId(null);
    },
    onError: (err: Error) => alert(err.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateUser(editId!, { email: editEmail.trim(), name: editName.trim(), role: editRole, schoolId: editSchoolId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setEditId(null); },
    onError: (err: Error) => alert(err.message),
  });

  function startEdit(u: UserRow) {
    setEditId(u.id);
    setEditEmail(u.email);
    setEditName(u.name);
    setEditRole(u.role);
    setEditSchoolId(u.schoolId);
    setAdding(false);
  }

  const userSchoolOptions = schools.map((s) => s.name);
  const userFiltersActive = filterRoles.length > 0 || filterUserSchools.length > 0;

  const shownUsers = userList.filter((u) => {
    if (userSearch) {
      const q = userSearch.toLowerCase();
      if (!u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    }
    if (filterRoles.length > 0) {
      const matchedEnums = filterRoles.map((label) =>
        (Object.entries(ALL_ROLES_MAP) as [string, string][]).find(([, v]) => v === label)?.[0] ?? ""
      );
      if (!matchedEnums.includes(u.role)) return false;
    }
    if (filterUserSchools.length > 0) {
      const schoolName = schools.find((s) => s.id === u.schoolId)?.name ?? "";
      if (!filterUserSchools.includes(schoolName)) return false;
    }
    return true;
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
    </div>
  );

  if (userView === "bulk" && canBulkImport) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 border-b border-slate-200 pb-0">
          <button
            onClick={() => setUserView("list")}
            className="px-4 py-2 text-sm font-semibold transition-colors"
            style={{ color: "#64748b", borderBottom: "3px solid transparent" }}
          >
            Users
          </button>
          <button
            className="px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-1.5"
            style={{ color: NAVY, borderBottom: `3px solid ${NAVY}` }}
          >
            <Upload size={13} />
            Bulk Import
          </button>
        </div>
        <BulkImport />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-slate-200 pb-0">
        <button
          className="px-4 py-2 text-sm font-semibold transition-colors"
          style={{ color: NAVY, borderBottom: `3px solid ${NAVY}` }}
        >
          Users
        </button>
        {canBulkImport && (
          <button
            onClick={() => setUserView("bulk")}
            className="px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-1.5"
            style={{ color: "#64748b", borderBottom: "3px solid transparent" }}
          >
            <Upload size={13} />
            Bulk Import
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="pl-8 pr-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white w-52"
            placeholder="Search name or email…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
          {userSearch && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setUserSearch("")}><X size={12} /></button>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} />

        {/* Filters label */}
        <span className="font-bold uppercase tracking-widest shrink-0" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}>
          Filters
        </span>

        <FilterMultiSelect label="Role" values={filterRoles} onChange={setFilterRoles} options={availableRoles.map((r) => ALL_ROLES_MAP[r])} />
        {isNetworkAdmin && userSchoolOptions.length > 0 && (
          <FilterMultiSelect label="School" values={filterUserSchools} onChange={setFilterUserSchools} options={userSchoolOptions} />
        )}

        {(userFiltersActive || userSearch) && (
          <button
            onClick={() => { setFilterRoles([]); setFilterUserSchools([]); setUserSearch(""); }}
            className="font-semibold underline underline-offset-2 text-sm"
            style={{ color: NAVY }}
          >
            Clear all
          </button>
        )}

        <div className="ml-auto">
          <button
            onClick={() => { setAdding(true); setEditId(null); }}
            className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90 shrink-0"
            style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
          >
            <Plus size={14} />
            Add User
          </button>
        </div>
      </div>

      {adding && (
        <div className="bg-white rounded-lg p-4 flex flex-col gap-3 shadow-sm" style={{ border: `2px solid ${NAVY}` }}>
          <p className="font-bold text-slate-700 text-sm">Add New User</p>
          <div className="flex flex-wrap gap-3">
            <input
              className={`${inputCls} flex-1 min-w-[200px]`}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email address"
              type="email"
              autoFocus
            />
            <input
              className={`${inputCls} flex-1 min-w-[160px]`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
            />
            <select className={`${selCls} min-w-[140px]`} value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
              {availableRoles.map((r) => <option key={r} value={r}>{ALL_ROLES_MAP[r]}</option>)}
            </select>
            {isNetworkAdmin && (
              <select className={`${selCls} min-w-[160px]`} value={newSchoolId ?? ""} onChange={(e) => setNewSchoolId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— School (optional) —</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className="px-4 py-1.5 rounded font-bold text-white text-sm disabled:opacity-50"
              style={{ backgroundColor: NAVY }}
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !newEmail.trim() || !newName.trim()}
            >
              {createMut.isPending ? "Adding…" : "Add User"}
            </button>
            <button className="px-4 py-1.5 rounded font-semibold text-slate-600 text-sm hover:bg-slate-100" onClick={() => { setAdding(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: NAVY, color: "white" }}>
              <th className="text-left px-4 py-2.5 font-semibold" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>Name</th>
              <th className="text-left px-4 py-2.5 font-semibold hidden sm:table-cell" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>Email</th>
              <th className="text-left px-4 py-2.5 font-semibold" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>Role</th>
              {isNetworkAdmin && <th className="text-left px-4 py-2.5 font-semibold hidden lg:table-cell" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.03em" }}>School</th>}
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {userList.length === 0 && (
              <tr><td colSpan={isNetworkAdmin ? 5 : 4} className="text-center py-8 text-slate-400">No users found.</td></tr>
            )}
            {userList.length > 0 && shownUsers.length === 0 && (
              <tr><td colSpan={isNetworkAdmin ? 5 : 4} className="text-center py-8 text-slate-400">No users match your filters.</td></tr>
            )}
            {shownUsers.map((u) => (
              <tr key={u.id}>
                {editId === u.id ? (
                  <td colSpan={isNetworkAdmin ? 5 : 4} className="px-4 py-3 bg-blue-50">
                    <div className="flex flex-wrap gap-3 items-start">
                      <input className={`${inputCls} flex-1 min-w-[160px]`} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Full name" autoFocus />
                      <input className={`${inputCls} flex-1 min-w-[200px]`} value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" type="email" />
                      <select className={`${selCls} min-w-[140px]`} value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)}>
                        {availableRoles.map((r) => <option key={r} value={r}>{ALL_ROLES_MAP[r]}</option>)}
                      </select>
                      {isNetworkAdmin && (
                        <select className={`${selCls} min-w-[160px]`} value={editSchoolId ?? ""} onChange={(e) => setEditSchoolId(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">— No school —</option>
                          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      )}
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 rounded font-bold text-white text-sm disabled:opacity-50" style={{ backgroundColor: NAVY }} onClick={() => updateMut.mutate()} disabled={updateMut.isPending}>{updateMut.isPending ? "Saving…" : "Save"}</button>
                        <button className="px-3 py-1.5 rounded font-semibold text-slate-600 text-sm hover:bg-slate-100" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{u.name}</td>
                    <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-bold rounded-full px-2.5 py-0.5" style={{ backgroundColor: "#e0e7ff", color: NAVY }}>
                        {ALL_ROLES_MAP[u.role] ?? u.role}
                      </span>
                    </td>
                    {isNetworkAdmin && <td className="px-4 py-2.5 text-slate-500 hidden lg:table-cell">{u.schoolName ?? <span className="text-slate-300 italic">None</span>}</td>}
                    <td className="px-4 py-2.5 text-right">
                      <button className="text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors" onClick={() => startEdit(u)} title="Edit">
                        <Pencil size={13} />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-center text-slate-400 text-xs pb-2">
        Only provisioned users can sign in. Add a user here before they attempt to log in.
      </p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   BULK IMPORT TAB (Network Admin only)
   ════════════════════════════════════════════════════════════════ */

const CSV_TEMPLATE_ROWS = [
  "name,email,role,school",
  "Jane Smith,jane.smith@example.org,COACH,Lincoln Middle School",
  "Carlos Rivera,c.rivera@example.org,SCHOOL_LEADER,Jefferson High School",
].join("\n");

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

function parseCSV(text: string): BulkImportUserPayload[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const results: BulkImportUserPayload[] = [];
  if (lines.length < 2) return results;

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const nameIdx   = headers.indexOf("name");
  const emailIdx  = headers.indexOf("email");
  const roleIdx   = headers.indexOf("role");
  const schoolIdx = headers.indexOf("school");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    results.push({
      name:   nameIdx   >= 0 ? (cols[nameIdx]   ?? "") : "",
      email:  emailIdx  >= 0 ? (cols[emailIdx]  ?? "") : "",
      role:   roleIdx   >= 0 ? (cols[roleIdx]   ?? "") : "",
      school: schoolIdx >= 0 ? (cols[schoolIdx] ?? "") : "",
    });
  }
  return results;
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE_ROWS], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "user_import_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function BulkImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<BulkImportUserPayload[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [importResult, setImportResult] = useState<BulkImportRowResult[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      alert("Please upload a .csv file.");
      return;
    }
    setFileName(file.name);
    setImportResult(null);
    setSubmitError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setPreview(parseCSV(text));
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (!preview || preview.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await bulkImportUsers(preview);
      setImportResult(result.results);
      setPreview(null);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setPreview(null);
    setFileName("");
    setImportResult(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const created = importResult?.filter((r) => r.status === "created")  ?? [];
  const skipped = importResult?.filter((r) => r.status === "skipped")  ?? [];
  const errors  = importResult?.filter((r) => r.status === "error")    ?? [];

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  return (
    <div className="flex flex-col gap-5">

      {/* Format guide */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
          <FileText size={15} className="text-yellow-300" />
          <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}>
            CSV Format Guide
          </span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            Upload a <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">.csv</code> file with the following columns.
            The first row must be the header row. Column names are case-insensitive.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Column</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Required</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wide">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  { col: "name",   req: true,  desc: "Full name of the user" },
                  { col: "email",  req: true,  desc: "Email address (must be unique)" },
                  { col: "role",   req: true,  desc: "COACH, SCHOOL_LEADER, or NETWORK_LEADER" },
                  { col: "school", req: false, desc: "Exact school name — required for COACH and SCHOOL_LEADER; leave blank for NETWORK_LEADER" },
                ].map(({ col, req, desc }) => (
                  <tr key={col}>
                    <td className="px-3 py-2"><code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono font-bold">{col}</code></td>
                    <td className="px-3 py-2">
                      {req
                        ? <span className="text-xs font-bold text-red-600">Required</span>
                        : <span className="text-xs text-slate-400">Optional</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={downloadTemplate}
            className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
          >
            <Download size={14} />
            Download Template
          </button>
        </div>
      </div>

      {/* File picker */}
      {!importResult && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
            <Upload size={15} className="text-yellow-300" />
            <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}>
              Upload CSV
            </span>
          </div>
          <div className="px-4 py-4 flex flex-col gap-3">
            <div
              className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-3 cursor-pointer transition-colors hover:border-blue-400 hover:bg-blue-50"
              style={{ borderColor: "#c7d2e8" }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleFile(file); }}
            >
              <Upload size={28} className="text-slate-300" />
              <p className="text-sm text-slate-500 text-center">
                <span className="font-semibold" style={{ color: NAVY }}>Click to browse</span> or drag and drop a CSV file here
              </p>
              {fileName && (
                <span className="text-xs text-green-700 font-semibold bg-green-100 px-2.5 py-1 rounded-full">{fileName}</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }}
            />
          </div>
        </div>
      )}

      {/* Preview table */}
      {preview && preview.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
          <div className="px-4 py-2.5 flex items-center justify-between gap-2" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
            <span className="font-bold uppercase text-white" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}>
              Preview — {preview.length} row{preview.length !== 1 ? "s" : ""}
            </span>
            <button onClick={resetAll} className="text-blue-300 hover:text-white p-1"><X size={16} /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">#</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">School</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{row.name || <span className="text-red-400 italic">missing</span>}</td>
                    <td className="px-3 py-2 text-slate-600">{row.email || <span className="text-red-400 italic">missing</span>}</td>
                    <td className="px-3 py-2">
                      <span
                        className="text-xs font-bold rounded-full px-2 py-0.5"
                        style={
                          ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER"].includes(row.role.toUpperCase())
                            ? { backgroundColor: "#e0e7ff", color: NAVY }
                            : { backgroundColor: "#fee2e2", color: "#dc2626" }
                        }
                      >
                        {row.role || <em>missing</em>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{row.school || <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {submitError && (
            <div className="px-4 py-3 bg-red-50 border-t border-red-200 flex items-start gap-2 text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              {submitError}
            </div>
          )}
          <div className="px-4 py-3 border-t border-slate-100 flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
            >
              {submitting ? "Importing…" : `Import ${preview.length} User${preview.length !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={resetAll}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Results summary */}
      {importResult && (
        <div className="flex flex-col gap-3">
          {/* Summary header */}
          <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-4" style={{ border: "1px solid #dde3f0" }}>
            <span className="font-bold text-slate-700 text-sm">Import complete:</span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-green-700">
              <CheckCircle2 size={15} />{created.length} created
            </span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-amber-600">
              <SkipForward size={15} />{skipped.length} skipped
            </span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-red-600">
              <AlertCircle size={15} />{errors.length} error{errors.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={resetAll}
              className="ml-auto px-4 py-1.5 rounded-lg text-sm font-bold text-white hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
            >
              Import Another File
            </button>
          </div>

          {/* Created */}
          {created.length > 0 && (
            <ResultSection
              title={`Created (${created.length})`}
              rows={created}
              headerStyle={{ backgroundColor: "#16a34a" }}
              statusBadge={(r) => <span className="text-xs font-bold text-green-700 bg-green-100 rounded-full px-2 py-0.5">Created</span>}
            />
          )}

          {/* Skipped */}
          {skipped.length > 0 && (
            <ResultSection
              title={`Skipped — Duplicate Email (${skipped.length})`}
              rows={skipped}
              headerStyle={{ backgroundColor: "#d97706" }}
              statusBadge={(r) => <span className="text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">{r.reason ?? "Skipped"}</span>}
            />
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <ResultSection
              title={`Errors (${errors.length})`}
              rows={errors}
              headerStyle={{ backgroundColor: "#dc2626" }}
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
  rows: BulkImportRowResult[];
  headerStyle: React.CSSProperties;
  statusBadge: (r: BulkImportRowResult) => React.ReactNode;
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
   ADMIN PAGE (root)
   ════════════════════════════════════════════════════════════════ */

type AdminTab = "rubric" | "roster" | "schools" | "users";

export default function AdminPage() {
  const { currentUser, isLoading: userLoading } = useUser();
  const [activeTab, setActiveTab] = useState<AdminTab>("rubric");

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

  /* Sync selected slug to first active set only if the current slug doesn't exist at all */
  useEffect(() => {
    if (activeSets.length > 0 && !rubricSets.find((q) => q.slug === selectedRubricSetSlug)) {
      setSelectedRubricSetSlug(activeSets[0].slug);
    }
  }, [rubricSets]);

  /* New Rubric Set dialog */
  const [showNewRubricSetDialog, setShowNewRubricSetDialog] = useState(false);
  const [newQName, setNewQName]         = useState("");
  const [newQGradeSpan, setNewQGradeSpan] = useState<string>("");
  const [copyFromSlug, setCopyFromSlug] = useState<string>("");

  function slugify(s: string) {
    return s.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
  }

  const createQMut = useMutation({
    mutationFn: () => createRubricSet(
      slugify(newQName) || `RS${activeSets.length + 1}`,
      newQName.trim(),
      newQGradeSpan || undefined,
      copyFromSlug || undefined,
    ),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["rubricSets"] });
      setSelectedRubricSetSlug(created.slug);
      setShowNewRubricSetDialog(false);
      setNewQName("");
      setNewQGradeSpan("");
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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
      </div>
    );
  }

  if (!currentUser || currentUser.role === "COACH") {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>
        <div style={{ height: 5, backgroundColor: YELLOW }} />
        <header style={{ backgroundColor: NAVY }} className="shadow-md">
          <div className="px-4 sm:px-6 py-3 flex items-center gap-4">
            <a href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/`} className="flex items-center gap-2 font-semibold hover:opacity-80" style={{ color: YELLOW, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.02em" }}>
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
            href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/`}
            className="mt-2 px-6 py-2 rounded-lg font-bold text-white"
            style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.03em" }}
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  const isDistrictAdmin  = currentUser?.role === "NETWORK_ADMIN";
  const canManageUsers   = currentUser?.role === "NETWORK_ADMIN" || currentUser?.role === "SCHOOL_LEADER";
  const canBulkImport    = currentUser?.role === "NETWORK_ADMIN" || currentUser?.role === "SCHOOL_LEADER";

  const tabs: { id: AdminTab; label: string }[] = [
    ...(isDistrictAdmin ? [{ id: "rubric" as AdminTab, label: "Rubric Settings" }] : []),
    { id: "roster", label: "Teacher Roster" },
    ...(canManageUsers ? [{ id: "users" as AdminTab, label: "Users" }] : []),
    ...(isDistrictAdmin ? [{ id: "schools" as AdminTab, label: "Schools" }] : []),
  ];

  const visibleTab: AdminTab =
    (activeTab === "rubric" && !isDistrictAdmin) ? "roster" :
    (activeTab === "users"  && !canManageUsers)  ? "roster" :
    activeTab;

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ── Sticky header + tab bar ── */}
      <div className="sticky top-0 z-30 shadow-md">
        <AppHeader
          subtitle="Settings"
          basePath={import.meta.env.BASE_URL.replace(/\/$/, "")}
          backHref={import.meta.env.BASE_URL.replace(/\/$/, "") + "/"}
          backLabel="Dashboard"
          onAddObservation={() => {
            const base = import.meta.env.BASE_URL.replace(/\/$/, "");
            window.location.href = `${base}/`;
          }}
          actionCenterHref={
            (currentUser.role === "NETWORK_ADMIN" || currentUser.role === "NETWORK_LEADER")
              ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}/district-action-center`
              : `${import.meta.env.BASE_URL.replace(/\/$/, "")}/action-center`
          }
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

      {/* Tab content */}
      <main className="px-4 sm:px-6 py-5 max-w-4xl mx-auto w-full flex flex-col gap-5">

        {/* ── Rubric set manager (Rubric tab only, District Admin only) ── */}
        {visibleTab === "rubric" && isDistrictAdmin && (
          <div
            className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-3"
            style={{ border: "1px solid #dde3f0", borderLeft: `4px solid ${YELLOW}` }}
          >
            <span
              className="font-bold uppercase tracking-widest shrink-0"
              style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.03em" }}
            >
              Rubric
            </span>

            {rubricSetsLoading ? (
              <div className="inline-block w-5 h-5 rounded-full border-2 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
            ) : (
              <div className="flex gap-1.5 flex-wrap items-center">
                {activeSets.map((q, idx) => {
                  const selected = q.slug === selectedRubricSetSlug;
                  const isFirst = idx === 0;
                  const isLast = idx === activeSets.length - 1;
                  return (
                    <div key={q.slug} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title="Move left"
                        disabled={isFirst || reorderMut.isPending}
                        onClick={() => moveRubricSet(q.slug, "left")}
                        className="rounded p-0.5 transition-opacity disabled:opacity-20 hover:opacity-70"
                        style={{ color: NAVY }}
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedRubricSetSlug(q.slug)}
                        className="px-3 py-1 font-bold uppercase tracking-wide rounded transition-colors"
                        style={{
                          fontFamily: "'Bebas Neue', sans-serif",
                          fontSize: 14,
                          letterSpacing: "0.04em",
                          backgroundColor: selected ? NAVY : "transparent",
                          color: selected ? "white" : NAVY,
                          border: `1.5px solid ${NAVY}`,
                        }}
                      >
                        {q.name}
                        {q.gradeSpan && (
                          <span className="ml-1 text-xs opacity-70">({q.gradeSpan})</span>
                        )}
                      </button>
                      <button
                        type="button"
                        title="Move right"
                        disabled={isLast || reorderMut.isPending}
                        onClick={() => moveRubricSet(q.slug, "right")}
                        className="rounded p-0.5 transition-opacity disabled:opacity-20 hover:opacity-70"
                        style={{ color: NAVY }}
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              {atLimit && !rubricSetsLoading && (
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                  6/6 max — archive a set to add more
                </span>
              )}
              <button
                onClick={() => { if (!atLimit) { setShowNewRubricSetDialog(true); setNewQName(""); setNewQGradeSpan(""); setCopyFromSlug(""); } }}
                disabled={atLimit}
                title={atLimit ? "Archive a set before creating a new one (max 6)" : undefined}
                className="flex items-center gap-1.5 font-bold rounded-md px-3 py-1.5 text-sm transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
              >
                <Plus size={14} />
                New Rubric Set
              </button>
            </div>
          </div>
        )}

        {/* ── Archived rubric sets ─────────────────────────────── */}
        {visibleTab === "rubric" && isDistrictAdmin && archivedSets.length > 0 && (
          <div
            className="bg-white rounded-lg shadow-sm px-4 py-3"
            style={{ border: "1px solid #dde3f0", borderLeft: "4px solid #94a3b8" }}
          >
            <button
              type="button"
              onClick={() => setShowArchivedSets((v) => !v)}
              className="flex items-center gap-2 w-full text-left"
            >
              <Archive size={13} style={{ color: "#64748b" }} />
              <span className="font-bold uppercase tracking-widest text-slate-500" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.03em" }}>
                Archived Rubric Sets ({archivedSets.length})
              </span>
              <ChevronDown size={14} className="ml-auto text-slate-400 transition-transform" style={{ transform: showArchivedSets ? "rotate(180deg)" : "none" }} />
            </button>
            {showArchivedSets && (
              <div className="mt-3 flex flex-wrap gap-2">
                {archivedSets.map((q) => {
                  const isSelected = q.slug === selectedRubricSetSlug;
                  return (
                    <div
                      key={q.slug}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border cursor-pointer transition-colors"
                      style={{
                        borderColor: isSelected ? "#94a3b8" : "#cbd5e1",
                        backgroundColor: isSelected ? "#f1f5f9" : "#f8fafc",
                        outline: isSelected ? "2px solid #94a3b8" : "none",
                      }}
                      onClick={() => setSelectedRubricSetSlug(q.slug)}
                    >
                      <span className="font-bold uppercase text-slate-400" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.04em" }}>
                        {q.name}
                        {q.gradeSpan && <span className="ml-1 text-xs opacity-60">({q.gradeSpan})</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {visibleTab === "rubric" && isDistrictAdmin && <RubricSettings setSlug={selectedRubricSetSlug} />}
        {visibleTab === "roster" && <TeacherRoster isDistrictAdmin={isDistrictAdmin} canBulkImport={canBulkImport} />}
        {visibleTab === "users" && <UserManagement isNetworkAdmin={isDistrictAdmin} currentUserSchoolId={currentUser?.schoolId ?? null} canBulkImport={canBulkImport} />}
        {visibleTab === "schools" && isDistrictAdmin && <SchoolSettings />}
      </main>

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
                <label className="text-sm font-semibold text-slate-700">Grade Span (optional)</label>
                <select
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                  value={newQGradeSpan}
                  onChange={(e) => setNewQGradeSpan(e.target.value)}
                >
                  <option value="">— All grade spans —</option>
                  {GRADE_SPANS.map((gs) => (
                    <option key={gs} value={gs}>{gs === "ES" ? "Elementary (ES)" : gs === "MS" ? "Middle (MS)" : "High School (HS)"}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400">
                  {newQGradeSpan
                    ? `This rubric set will be scoped to ${newQGradeSpan} schools.`
                    : "Leave blank to apply this rubric set to all grade spans."}
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
                    <option key={q.slug} value={q.slug}>{q.name}</option>
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
    </div>
  );
}

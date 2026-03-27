import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, UserCheck, UserX, ShieldOff, ChevronDown, Copy, School } from "lucide-react";
import {
  fetchRubric,
  fetchQuarters,
  createQuarter,
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
  REGIONS,
  GRADE_SPANS,
  type FullRubric,
  type RubricCategoryRow,
  type RubricDomainRow,
  type RubricQuarterRow,
  type AdminTeacher,
  type AdminSchool,
} from "@/lib/api";
import { useUser } from "@/context/UserContext";
import { SUBJECTS, GRADE_LEVELS } from "@/data/dummy";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

/* ════════════════════════════════════════════════════════════════
   RUBRIC SETTINGS TAB
   ════════════════════════════════════════════════════════════════ */

function RubricSettings({ quarterSlug }: { quarterSlug: string }) {
  const queryClient = useQueryClient();
  const qKey = ["rubric", quarterSlug] as const;

  const { data, isLoading, isError } = useQuery<FullRubric>({
    queryKey: qKey,
    queryFn: () => fetchRubric(quarterSlug),
  });

  const [editingCatId,   setEditingCatId]   = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [editingDomId,   setEditingDomId]   = useState<number | null>(null);
  const [editingDomName, setEditingDomName] = useState("");
  const [editingDomSlug, setEditingDomSlug] = useState("");
  const [addingCat,         setAddingCat]         = useState(false);
  const [newCatName,        setNewCatName]        = useState("");
  const [addingDomForCat,   setAddingDomForCat]   = useState<number | null>(null);
  const [newDomName,        setNewDomName]        = useState("");
  const [newDomSlug,        setNewDomSlug]        = useState("");

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  const addCatMut = useMutation({
    mutationFn: ({ name, order }: { name: string; order: number }) => createCategory(quarterSlug, name, order),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setAddingCat(false); setNewCatName(""); },
  });

  const updCatMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateCategory(id, name),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setEditingCatId(null); },
  });

  const delCatMut = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  const addDomMut = useMutation({
    mutationFn: ({ catId, name, slug, order }: { catId: number; name: string; slug: string; order: number }) =>
      createDomain(catId, name, slug, order),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setAddingDomForCat(null); setNewDomName(""); setNewDomSlug(""); },
  });

  const updDomMut = useMutation({
    mutationFn: ({ id, name, slug }: { id: number; name: string; slug: string }) => updateDomain(id, name, slug),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setEditingDomId(null); },
  });

  const delDomMut = useMutation({
    mutationFn: (id: number) => deleteDomain(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qKey }),
  });

  function startEditCat(cat: RubricCategoryRow) {
    setEditingCatId(cat.id); setEditingCatName(cat.name); setEditingDomId(null);
  }

  function startEditDom(dom: RubricDomainRow) {
    setEditingDomId(dom.id); setEditingDomName(dom.name); setEditingDomSlug(dom.slug); setEditingCatId(null);
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
      <div className="flex items-center gap-3">
        <span
          className="px-4 py-1.5 rounded-full font-bold uppercase text-white"
          style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.03em" }}
        >
          {data.quarter.name}
        </span>
        <span className="text-slate-400 text-sm">Managing categories and domains for this quarter</span>
      </div>

      {data.categories.map((cat) => (
        <div key={cat.id} className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}>
            {editingCatId === cat.id ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  className="flex-1 px-3 py-1 rounded text-sm font-semibold focus:outline-none"
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
              <div key={dom.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                {editingDomId === dom.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input className={`${inputCls} flex-1`} value={editingDomName} onChange={(e) => setEditingDomName(e.target.value)} placeholder="Domain name" autoFocus onKeyDown={(e) => { if (e.key === "Enter") updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug }); if (e.key === "Escape") setEditingDomId(null); }} />
                    <input className={`${inputCls} w-36`} value={editingDomSlug} onChange={(e) => setEditingDomSlug(e.target.value)} placeholder="slug" onKeyDown={(e) => { if (e.key === "Enter") updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug }); if (e.key === "Escape") setEditingDomId(null); }} />
                    <button className="text-green-600 hover:text-green-800 p-1" onClick={() => updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug })}><Check size={16} /></button>
                    <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setEditingDomId(null)}><X size={16} /></button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 font-medium text-slate-700 text-sm">{dom.name}</span>
                    <code className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded font-mono">{dom.slug}</code>
                    <button className="text-slate-400 hover:text-blue-600 p-1.5 rounded" onClick={() => startEditDom(dom)}><Pencil size={13} /></button>
                    <button className="text-slate-400 hover:text-red-500 p-1.5 rounded" onClick={() => { if (confirm(`Delete domain "${dom.name}"?`)) delDomMut.mutate(dom.id); }}><Trash2 size={13} /></button>
                  </>
                )}
              </div>
            ))}

            {addingDomForCat === cat.id ? (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50">
                <input className={`${inputCls} flex-1`} value={newDomName} onChange={(e) => { setNewDomName(e.target.value); setNewDomSlug(slugify(e.target.value)); }} placeholder="Domain name" autoFocus />
                <input className={`${inputCls} w-36`} value={newDomSlug} onChange={(e) => setNewDomSlug(e.target.value)} placeholder="slug" />
                <button className="px-3 py-1.5 rounded text-sm font-bold text-white" style={{ backgroundColor: NAVY }} onClick={() => addDomMut.mutate({ catId: cat.id, name: newDomName, slug: newDomSlug || slugify(newDomName), order: cat.domains.length })}>Add</button>
                <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => { setAddingDomForCat(null); setNewDomName(""); setNewDomSlug(""); }}><X size={16} /></button>
              </div>
            ) : (
              <button className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold hover:bg-slate-50" style={{ color: NAVY }} onClick={() => { setAddingDomForCat(cat.id); setNewDomName(""); setNewDomSlug(""); }}>
                <Plus size={13} />Add domain
              </button>
            )}
          </div>
        </div>
      ))}

      {addingCat ? (
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3" style={{ border: `2px solid ${NAVY}` }}>
          <input className={`${inputCls} flex-1 font-semibold`} value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="New category name" autoFocus onKeyDown={(e) => { if (e.key === "Enter") addCatMut.mutate({ name: newCatName, order: data.categories.length }); if (e.key === "Escape") setAddingCat(false); }} />
          <button className="px-4 py-1.5 rounded font-bold text-white text-sm" style={{ backgroundColor: NAVY }} onClick={() => addCatMut.mutate({ name: newCatName, order: data.categories.length })}>Add Category</button>
          <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setAddingCat(false)}><X size={18} /></button>
        </div>
      ) : (
        <button className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-bold text-sm border-2 border-dashed hover:border-solid" style={{ borderColor: NAVY, color: NAVY }} onClick={() => setAddingCat(true)}>
          <Plus size={16} />Add Category
        </button>
      )}

      <p className="text-center text-slate-400 text-xs pb-4">
        Changes apply to all future and existing observations in {quarterSlug}. Existing scores for deleted domains will no longer display.
      </p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   TEACHER ROSTER TAB
   ════════════════════════════════════════════════════════════════ */

function TeacherRoster({ isDistrictAdmin }: { isDistrictAdmin: boolean }) {
  const queryClient = useQueryClient();
  const qKey = ["admin", "teachers"] as const;

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

  const [showInactive, setShowInactive] = useState(false);

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

  const shown = showInactive ? teachers : teachers.filter((t) => t.isActive);
  const colSpanTotal = isDistrictAdmin ? 6 : 5;

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-blue-700" />
          Show inactive teachers
        </label>
        <button
          onClick={() => { setAdding(true); setEditId(null); }}
          className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
        >
          <Plus size={14} />
          Add Teacher
        </button>
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

  function resetAdd() { setAdding(false); setNewName(""); setNewRegion(""); setNewSpan(""); }
  function resetEdit() { setEditId(null); }

  const createMut = useMutation({
    mutationFn: () => createAdminSchool({ name: newName.trim(), region: newRegion || null, gradeSpan: newSpan || null }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); resetAdd(); },
  });

  const updateMut = useMutation({
    mutationFn: () => updateAdminSchool(editId!, { name: editName.trim(), region: editRegion || null, gradeSpan: editSpan || null }),
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

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">Manage the schools in your district. Set each school's region and grade span.</p>
        <button
          onClick={() => { setAdding(true); setEditId(null); setNewName(""); setNewRegion(""); setNewSpan(""); }}
          className="flex items-center gap-1.5 font-bold rounded-md px-4 py-2 text-sm transition-opacity hover:opacity-90 shrink-0"
          style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
        >
          <Plus size={14} />
          Add School
        </button>
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
              disabled={createMut.isPending || !newName.trim()}
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
        <ul className="divide-y divide-slate-100">
          {schools.map((school) => (
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
                      disabled={updateMut.isPending || !editName.trim()}
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
                    {!school.region && !school.gradeSpan && (
                      <span className="text-xs text-slate-300 italic">No tags</span>
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
   ADMIN PAGE (root)
   ════════════════════════════════════════════════════════════════ */

type AdminTab = "rubric" | "roster" | "schools";

export default function AdminPage() {
  const { currentUser, isLoading: userLoading } = useUser();
  const [activeTab, setActiveTab] = useState<AdminTab>("rubric");

  /* ── Quarter management ─────────────────────────────────────── */
  const queryClient = useQueryClient();
  const { data: quarters = [], isLoading: quartersLoading } = useQuery<RubricQuarterRow[]>({
    queryKey: ["quarters"],
    queryFn: fetchQuarters,
    staleTime: 60_000,
  });

  const [selectedQuarterSlug, setSelectedQuarterSlug] = useState<string>("Q1");

  /* Sync selected quarter to the first available quarter once loaded */
  useEffect(() => {
    if (quarters.length > 0 && !quarters.find((q) => q.slug === selectedQuarterSlug)) {
      setSelectedQuarterSlug(quarters[0].slug);
    }
  }, [quarters]);

  /* New Quarter dialog */
  const [showNewQuarterDialog, setShowNewQuarterDialog] = useState(false);
  const [newQName, setNewQName]       = useState("");
  const [copyFromSlug, setCopyFromSlug] = useState<string>("");

  function slugify(s: string) {
    return s.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
  }

  const createQMut = useMutation({
    mutationFn: () => createQuarter(
      slugify(newQName) || `Q${quarters.length + 1}`,
      newQName.trim(),
      copyFromSlug || undefined,
    ),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["quarters"] });
      setSelectedQuarterSlug(created.slug);
      setShowNewQuarterDialog(false);
      setNewQName("");
      setCopyFromSlug("");
    },
  });

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
            Coaches do not have access to the Admin panel. Switch to a Principal or District Admin account to manage settings.
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

  const isDistrictAdmin = currentUser?.role === "DISTRICT_ADMIN";

  const tabs: { id: AdminTab; label: string }[] = [
    ...(isDistrictAdmin ? [{ id: "rubric" as AdminTab, label: "Rubric Settings" }] : []),
    { id: "roster", label: "Teacher Roster" },
    ...(isDistrictAdmin ? [{ id: "schools" as AdminTab, label: "Schools" }] : []),
  ];

  /* If a Principal lands on the rubric tab (e.g. bookmark), redirect to roster */
  const visibleTab = activeTab === "rubric" && !isDistrictAdmin ? "roster" : activeTab;

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>
      <div style={{ height: 5, backgroundColor: YELLOW }} />
      <header style={{ backgroundColor: NAVY }} className="sticky top-0 z-30 shadow-md">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-4">
          <a
            href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/`}
            className="flex items-center gap-2 font-semibold hover:opacity-80 transition-opacity"
            style={{ color: YELLOW, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.02em" }}
          >
            <ArrowLeft size={18} />
            Dashboard
          </a>
          <div style={{ width: 1, height: 28, backgroundColor: "rgba(255,181,0,0.4)" }} />
          <p className="text-white uppercase" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}>
            Admin Settings
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-blue-200 text-sm hidden sm:block">{currentUser?.name}</span>
            <span className="text-xs font-bold rounded-full px-2.5 py-0.5" style={{ backgroundColor: YELLOW, color: NAVY }}>
              {currentUser?.role?.replace("_", " ")}
            </span>
          </div>
        </div>
        <div style={{ height: 3, backgroundColor: YELLOW }} />
      </header>

      {/* Tab bar */}
      <div className="sticky top-[61px] z-20 bg-white shadow-sm border-b border-slate-200">
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

      {/* Tab content */}
      <main className="px-4 sm:px-6 py-5 max-w-4xl mx-auto w-full flex flex-col gap-5">

        {/* ── Quarter manager (Rubric tab only, District Admin only) ── */}
        {visibleTab === "rubric" && isDistrictAdmin && (
          <div
            className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-3"
            style={{ border: "1px solid #dde3f0", borderLeft: `4px solid ${YELLOW}` }}
          >
            <span
              className="font-bold uppercase tracking-widest shrink-0"
              style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.03em" }}
            >
              Quarter
            </span>

            {quartersLoading ? (
              <div className="inline-block w-5 h-5 rounded-full border-2 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                {quarters.map((q) => {
                  const active = q.slug === selectedQuarterSlug;
                  return (
                    <button
                      key={q.slug}
                      type="button"
                      onClick={() => setSelectedQuarterSlug(q.slug)}
                      className="px-3 py-1 font-bold uppercase tracking-wide rounded transition-colors"
                      style={{
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: 14,
                        letterSpacing: "0.04em",
                        backgroundColor: active ? NAVY : "transparent",
                        color: active ? "white" : NAVY,
                        border: `1.5px solid ${NAVY}`,
                      }}
                    >
                      {q.name}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => { setShowNewQuarterDialog(true); setNewQName(""); setCopyFromSlug(""); }}
              className="ml-auto flex items-center gap-1.5 font-bold rounded-md px-3 py-1.5 text-sm hover:opacity-90 transition-opacity"
              style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em" }}
            >
              <Plus size={14} />
              New Quarter
            </button>
          </div>
        )}

        {visibleTab === "rubric" && isDistrictAdmin && <RubricSettings quarterSlug={selectedQuarterSlug} />}
        {visibleTab === "roster" && <TeacherRoster isDistrictAdmin={isDistrictAdmin} />}
        {visibleTab === "schools" && isDistrictAdmin && <SchoolSettings />}
      </main>

      {/* ── New Quarter dialog ────────────────────────────────── */}
      {showNewQuarterDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewQuarterDialog(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between" style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}>
              <h2 className="text-white font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}>
                New Quarter
              </h2>
              <button onClick={() => setShowNewQuarterDialog(false)} className="text-blue-200 hover:text-white p-1">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">Quarter Name</label>
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
                    Slug: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{slugify(newQName) || `Q${quarters.length + 1}`}</code>
                  </p>
                )}
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
                  {quarters.map((q) => (
                    <option key={q.slug} value={q.slug}>{q.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400">
                  {copyFromSlug
                    ? `All categories and domains from ${quarters.find((q) => q.slug === copyFromSlug)?.name} will be copied.`
                    : "The new quarter will start with no categories or domains."}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex justify-end gap-3">
              <button
                onClick={() => setShowNewQuarterDialog(false)}
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
                {createQMut.isPending ? "Creating…" : "Create Quarter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

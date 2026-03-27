import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import {
  fetchRubric,
  createCategory,
  updateCategory,
  deleteCategory,
  createDomain,
  updateDomain,
  deleteDomain,
  type FullRubric,
  type RubricCategoryRow,
  type RubricDomainRow,
} from "@/lib/api";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

export default function AdminPage() {
  const queryClient = useQueryClient();
  const qKey = ["rubric", "Q1"] as const;

  const { data, isLoading, isError } = useQuery<FullRubric>({
    queryKey: qKey,
    queryFn: () => fetchRubric("Q1"),
  });

  /* ── Inline edit state ──────────────────────────── */
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [editingDomId, setEditingDomId] = useState<number | null>(null);
  const [editingDomName, setEditingDomName] = useState("");
  const [editingDomSlug, setEditingDomSlug] = useState("");

  /* ── Add state ──────────────────────────────────── */
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [addingDomForCat, setAddingDomForCat] = useState<number | null>(null);
  const [newDomName, setNewDomName] = useState("");
  const [newDomSlug, setNewDomSlug] = useState("");

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  /* ── Mutations ──────────────────────────────────── */
  const addCatMut = useMutation({
    mutationFn: ({ name, order }: { name: string; order: number }) =>
      createCategory("Q1", name, order),
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

  /* ── Helpers ────────────────────────────────────── */
  function startEditCat(cat: RubricCategoryRow) {
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
    setEditingDomId(null);
  }

  function startEditDom(dom: RubricDomainRow) {
    setEditingDomId(dom.id);
    setEditingDomName(dom.name);
    setEditingDomSlug(dom.slug);
    setEditingCatId(null);
  }

  const inputCls = "px-3 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <p className="text-red-600 font-semibold">Failed to load rubric. Make sure the API server is running.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* Header */}
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
          <p
            className="text-white uppercase"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}
          >
            Admin · Rubric Manager
          </p>
        </div>
        <div style={{ height: 3, backgroundColor: YELLOW }} />
      </header>

      {/* Content */}
      <main className="px-4 sm:px-6 py-5 max-w-3xl mx-auto w-full flex flex-col gap-5">

        {/* Quarter badge */}
        <div className="flex items-center gap-3">
          <span
            className="px-4 py-1.5 rounded-full font-bold uppercase text-white"
            style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.03em" }}
          >
            {data.quarter.name}
          </span>
          <span className="text-slate-400 text-sm">Managing categories and domains for this quarter</span>
        </div>

        {/* Categories */}
        {data.categories.map((cat) => (
          <div
            key={cat.id}
            className="bg-white rounded-lg shadow-sm overflow-hidden"
            style={{ border: "1px solid #dde3f0" }}
          >
            {/* Category header */}
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ backgroundColor: NAVY, borderBottom: `2px solid ${YELLOW}` }}
            >
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
                  <button
                    className="text-green-400 hover:text-green-200 transition-colors p-1"
                    onClick={() => updCatMut.mutate({ id: cat.id, name: editingCatName })}
                    title="Save"
                  >
                    <Check size={16} />
                  </button>
                  <button className="text-blue-300 hover:text-white transition-colors p-1" onClick={() => setEditingCatId(null)} title="Cancel">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <span
                    className="font-bold uppercase text-white"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: "0.02em" }}
                  >
                    {cat.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      className="text-blue-300 hover:text-white transition-colors p-1.5 rounded"
                      onClick={() => startEditCat(cat)}
                      title="Edit category"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="text-red-400 hover:text-red-200 transition-colors p-1.5 rounded"
                      onClick={() => {
                        if (confirm(`Delete category "${cat.name}" and all its domains?`)) delCatMut.mutate(cat.id);
                      }}
                      title="Delete category"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Domains */}
            <div className="divide-y divide-slate-100">
              {cat.domains.map((dom) => (
                <div key={dom.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                  {editingDomId === dom.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        className={`${inputCls} flex-1`}
                        value={editingDomName}
                        onChange={(e) => setEditingDomName(e.target.value)}
                        placeholder="Domain name"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug });
                          if (e.key === "Escape") setEditingDomId(null);
                        }}
                      />
                      <input
                        className={`${inputCls} w-36`}
                        value={editingDomSlug}
                        onChange={(e) => setEditingDomSlug(e.target.value)}
                        placeholder="slug"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug });
                          if (e.key === "Escape") setEditingDomId(null);
                        }}
                      />
                      <button
                        className="text-green-600 hover:text-green-800 transition-colors p-1"
                        onClick={() => updDomMut.mutate({ id: dom.id, name: editingDomName, slug: editingDomSlug })}
                        title="Save"
                      >
                        <Check size={16} />
                      </button>
                      <button className="text-slate-400 hover:text-slate-600 transition-colors p-1" onClick={() => setEditingDomId(null)} title="Cancel">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 font-medium text-slate-700 text-sm">{dom.name}</span>
                      <code className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded font-mono">{dom.slug}</code>
                      <button
                        className="text-slate-400 hover:text-blue-600 transition-colors p-1.5 rounded"
                        onClick={() => startEditDom(dom)}
                        title="Edit domain"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="text-slate-400 hover:text-red-500 transition-colors p-1.5 rounded"
                        onClick={() => {
                          if (confirm(`Delete domain "${dom.name}"?`)) delDomMut.mutate(dom.id);
                        }}
                        title="Delete domain"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}

              {/* Add domain row */}
              {addingDomForCat === cat.id ? (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50">
                  <input
                    className={`${inputCls} flex-1`}
                    value={newDomName}
                    onChange={(e) => { setNewDomName(e.target.value); setNewDomSlug(slugify(e.target.value)); }}
                    placeholder="Domain name"
                    autoFocus
                  />
                  <input
                    className={`${inputCls} w-36`}
                    value={newDomSlug}
                    onChange={(e) => setNewDomSlug(e.target.value)}
                    placeholder="slug"
                  />
                  <button
                    className="px-3 py-1.5 rounded text-sm font-bold text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: NAVY }}
                    onClick={() =>
                      addDomMut.mutate({
                        catId: cat.id,
                        name: newDomName,
                        slug: newDomSlug || slugify(newDomName),
                        order: cat.domains.length,
                      })
                    }
                  >
                    Add
                  </button>
                  <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => { setAddingDomForCat(null); setNewDomName(""); setNewDomSlug(""); }}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold hover:bg-slate-50 transition-colors"
                  style={{ color: NAVY }}
                  onClick={() => { setAddingDomForCat(cat.id); setNewDomName(""); setNewDomSlug(""); }}
                >
                  <Plus size={13} />
                  Add domain
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Add category */}
        {addingCat ? (
          <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3" style={{ border: `2px solid ${NAVY}` }}>
            <input
              className={`${inputCls} flex-1 font-semibold`}
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="New category name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") addCatMut.mutate({ name: newCatName, order: data.categories.length });
                if (e.key === "Escape") setAddingCat(false);
              }}
            />
            <button
              className="px-4 py-1.5 rounded font-bold text-white text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: NAVY }}
              onClick={() => addCatMut.mutate({ name: newCatName, order: data.categories.length })}
            >
              Add Category
            </button>
            <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setAddingCat(false)}>
              <X size={18} />
            </button>
          </div>
        ) : (
          <button
            className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-bold text-sm border-2 border-dashed transition-colors hover:border-solid"
            style={{ borderColor: NAVY, color: NAVY, backgroundColor: "transparent" }}
            onClick={() => setAddingCat(true)}
          >
            <Plus size={16} />
            Add Category
          </button>
        )}

        <p className="text-center text-slate-400 text-xs pb-4">
          Changes apply to all future and existing observations in Q1.
          Existing scores for deleted domains will no longer display.
        </p>
      </main>
    </div>
  );
}

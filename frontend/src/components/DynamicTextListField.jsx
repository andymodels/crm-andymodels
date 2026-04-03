function DynamicTextListField({
  label,
  items,
  placeholder,
  onAdd,
  onUpdate,
  onRemove,
}) {
  return (
    <div className="md:col-span-2 rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          onClick={onAdd}
        >
          + adicionar
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${label}-${index}`} className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              value={item}
              onChange={(event) => onUpdate(index, event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
              placeholder={placeholder}
            />
            <button
              type="button"
              className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700"
              onClick={() => onRemove(index)}
            >
              remover
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DynamicTextListField;

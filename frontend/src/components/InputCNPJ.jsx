import { formatCnpjDisplay, onlyDigits } from '../utils/brMasks';

export default function InputCNPJ({
  value = '',
  onChange,
  onBlur,
  className = 'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring',
  placeholder = '00.000.000/0000-00',
  disabled = false,
  required = false,
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={formatCnpjDisplay(String(value ?? ''))}
      onChange={(event) => onChange(formatCnpjDisplay(onlyDigits(event.target.value)))}
      onBlur={onBlur}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
    />
  );
}

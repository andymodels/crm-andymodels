import { formatCpfDisplay, onlyDigits } from '../utils/brMasks';

export default function InputCPF({
  value = '',
  onChange,
  className = 'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring',
  placeholder = '000.000.000-00',
  disabled = false,
  required = false,
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={formatCpfDisplay(String(value ?? ''))}
      onChange={(event) => onChange(formatCpfDisplay(onlyDigits(event.target.value)))}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
    />
  );
}

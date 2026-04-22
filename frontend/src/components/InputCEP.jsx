import { formatCepDisplay, onlyDigits } from '../utils/brMasks';

export default function InputCEP({
  value = '',
  onChange,
  onBlur,
  className = 'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring',
  placeholder = '00000-000',
  disabled = false,
  required = false,
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="postal-code"
      value={formatCepDisplay(String(value ?? ''))}
      onChange={(event) => onChange(formatCepDisplay(onlyDigits(event.target.value)))}
      onBlur={onBlur}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
    />
  );
}

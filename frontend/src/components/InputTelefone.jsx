import { formatPhoneDisplay, onlyDigits } from '../utils/brMasks';

export default function InputTelefone({
  value = '',
  onChange,
  className = 'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-slate-300 focus:ring',
  placeholder = '(11) 99999-9999',
  disabled = false,
  required = false,
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="tel"
      value={formatPhoneDisplay(String(value ?? ''))}
      onChange={(event) => onChange(formatPhoneDisplay(onlyDigits(event.target.value)))}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
    />
  );
}

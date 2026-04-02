import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface ComposerSelectOption {
  value: string;
  label: string;
}

interface ComposerSelectProps {
  title: string;
  value: string;
  placeholder: string;
  options: ComposerSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

function ComposerSelect(props: ComposerSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = props.options.find(option => option.value === props.value);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`composer-select ${props.className ?? ''} ${open ? 'is-open' : ''} ${props.disabled ? 'is-disabled' : ''}`.trim()}
    >
      <button
        className="composer-select-trigger"
        type="button"
        onClick={() => {
          if (props.disabled) return;
          setOpen(current => !current);
        }}
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="composer-select-trigger-label">{selectedOption?.label || props.placeholder}</span>
        <ChevronDown className="composer-select-trigger-icon" size={14} />
      </button>

      {open && !props.disabled && (
        <div className="composer-select-menu" role="listbox" aria-label={props.title}>
          <div className="composer-select-title">{props.title}</div>
          <div className="composer-select-options">
            {props.options.map(option => {
              const selected = option.value === props.value;
              return (
                <button
                  key={option.value}
                  className={`composer-select-option ${selected ? 'is-selected' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    props.onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="composer-select-option-label">{option.label}</span>
                  <span className="composer-select-option-check" aria-hidden="true">
                    {selected ? <Check size={14} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ComposerSelect;

import type { ReactElement } from "react";

export interface ToggleProperties {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}

export function Toggle({ on, disabled, onChange, label }: ToggleProperties): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`toggle ${on ? "toggle-on" : ""} ${disabled ? "toggle-busy" : ""}`}
    >
      <span className="toggle-knob" aria-hidden="true" />
    </button>
  );
}

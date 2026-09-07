import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";

interface DigitInputProps {
  length: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: "text" | "password";
  error?: boolean;
  autoFocus?: boolean;
  onComplete?: (value: string) => void;
}

export interface DigitInputRef {
  focus: () => void;
}

export const DigitInput = forwardRef<DigitInputRef, DigitInputProps>(({
  length,
  value,
  onChange,
  disabled = false,
  type = "text",
  error = false,
  autoFocus = false,
  onComplete
}, ref) => {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputsRef.current[0]?.focus();
    }
  }));

  // Initialize or update the refs array size when length changes
  useEffect(() => {
    inputsRef.current = inputsRef.current.slice(0, length);
    if (autoFocus) {
      setTimeout(() => {
        inputsRef.current[0]?.focus();
      }, 50);
    }
  }, [length, autoFocus]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const val = e.target.value;
    // We only accept digits
    const cleaned = val.replace(/\D/g, "");
    if (!cleaned) {
      // If the field was cleared, update state
      const newValue = value.split("");
      newValue[index] = "";
      onChange(newValue.join(""));
      return;
    }

    const newValue = value.split("");
    // Take the last character typed (in case the box already had a digit)
    newValue[index] = cleaned[cleaned.length - 1];
    const joined = newValue.join("");
    onChange(joined);

    // Auto-focus next box
    if (index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    } else if (joined.length === length) {
      onComplete?.(joined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const newValue = value.split("");
      
      if (newValue[index]) {
        // If current box has value, clear it
        newValue[index] = "";
        onChange(newValue.join(""));
      } else if (index > 0) {
        // If current box is empty, clear the previous box and focus it
        newValue[index - 1] = "";
        onChange(newValue.join(""));
        inputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text");
    const cleaned = pastedData.replace(/\D/g, "").slice(0, length);
    if (cleaned) {
      onChange(cleaned);
      // Focus the last input box or the next empty one
      const focusIndex = Math.min(cleaned.length, length - 1);
      inputsRef.current[focusIndex]?.focus();
      
      if (cleaned.length === length) {
        onComplete?.(cleaned);
      }
    }
  };

  // Build array of length N
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  return (
    <div className="flex gap-2 justify-center my-2">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputsRef.current[index] = el; }}
          type={type === "password" ? "password" : "text"}
          pattern="\d*"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={handlePaste}
          autoComplete="one-time-code"
          className={`w-10 h-12 text-center text-xl font-bold rounded-lg border-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
            error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
              : "border-slate-200 dark:border-slate-700 focus:border-indigo-500 dark:focus:border-indigo-400"
          } ${disabled ? "opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-900" : ""}`}
        />
      ))}
    </div>
  );
});

DigitInput.displayName = "DigitInput";

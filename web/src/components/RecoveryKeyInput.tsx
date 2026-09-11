import React, { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { validateRecoveryGroup } from "../utils/auth";

/**
 * Props for RecoveryKeyInput component.
 */
export interface RecoveryKeyInputProps {
  /** The full recovery key value (formatted or raw digits). */
  value: string;
  /** Callback triggered when any group changes. */
  onChange: (value: string) => void;
  /** Whether inputs are disabled. */
  disabled?: boolean;
  /** Whether to auto-focus the first input group on mount. */
  autoFocus?: boolean;
  /** Optional custom class name for container. */
  className?: string;
}

/**
 * RecoveryKeyInput renders 5 segmented inputs for a 30-digit recovery key.
 * Each group consists of 6 digits and enforces Modulo 11 check digit validation.
 * When an invalid check digit is detected in any group of 6 digits, a red border
 * is highlighted on that specific group.
 */
export const RecoveryKeyInput: React.FC<RecoveryKeyInputProps> = ({
  value,
  onChange,
  disabled = false,
  autoFocus = true,
  className = ""
}) => {
  const { t } = useTranslation();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Parse current value into 5 groups of 6 digits
  const getGroupsFromValue = (val: string): string[] => {
    const digits = val.replace(/\D/g, "").slice(0, 30);
    const groups: string[] = [];
    for (let i = 0; i < 5; i++) {
      groups.push(digits.slice(i * 6, (i + 1) * 6));
    }
    return groups;
  };

  const groups = getGroupsFromValue(value);

  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const handleGroupChange = (index: number, newText: string) => {
    const cleanDigits = newText.replace(/\D/g, "").slice(0, 6);
    const updatedGroups = [...groups];
    updatedGroups[index] = cleanDigits;

    // Combine and propagate
    onChange(updatedGroups.join("-"));

    // Auto-focus next input if filled 6 digits
    if (cleanDigits.length === 6 && index < 4) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && groups[index].length === 0 && index > 0) {
      // Focus previous input and position cursor at end
      e.preventDefault();
      const prevInput = inputRefs.current[index - 1];
      if (prevInput) {
        prevInput.focus();
      }
    } else if (e.key === "ArrowLeft" && (e.currentTarget.selectionStart ?? 0) === 0 && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (
      e.key === "ArrowRight" &&
      (e.currentTarget.selectionStart ?? 0) === groups[index].length &&
      index < 4
    ) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    const digits = pasted.replace(/\D/g, "");

    // If pasted string contains more than 6 digits, distribute across groups starting from index
    if (digits.length > 6) {
      e.preventDefault();
      const updatedGroups = [...groups];
      let offset = 0;
      for (let i = index; i < 5 && offset < digits.length; i++) {
        const chunk = digits.slice(offset, offset + 6);
        updatedGroups[i] = chunk;
        offset += chunk.length;
      }
      onChange(updatedGroups.join("-"));

      // Focus the last filled or next unfilled box
      const nextIndex = Math.min(4, index + Math.ceil(digits.length / 6) - 1);
      inputRefs.current[nextIndex]?.focus();
    }
  };

  // Find any group with 6 digits that fails Modulo 11 check
  const invalidGroupIndices = groups
    .map((grp, idx) => (grp.length === 6 && !validateRecoveryGroup(grp) ? idx : -1))
    .filter((idx) => idx !== -1);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-1 sm:gap-2">
        {groups.map((group, idx) => {
          const isComplete = group.length === 6;
          const isInvalid = isComplete && !validateRecoveryGroup(group);
          const isValid = isComplete && !isInvalid;

          let borderClass =
            "border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
          if (isInvalid) {
            borderClass =
              "border-red-500 ring-2 ring-red-500/30 bg-red-50/40 dark:bg-red-950/20 text-red-600 dark:text-red-400";
          } else if (isValid) {
            borderClass =
              "border-green-500/80 dark:border-green-500/60 bg-green-50/20 dark:bg-green-950/10 text-gray-900 dark:text-gray-100";
          }

          return (
            <React.Fragment key={idx}>
              <input
                ref={(el) => {
                  inputRefs.current[idx] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={group}
                disabled={disabled}
                placeholder="000000"
                onChange={(e) => handleGroupChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                onPaste={(e) => handlePaste(idx, e)}
                className={`w-full min-w-0 text-center font-mono text-xs sm:text-sm tracking-wider py-2 sm:py-2.5 px-1 rounded-lg border transition-all duration-150 outline-none ${borderClass}`}
                title={
                  isInvalid
                    ? t("auth.recoveryChecksumError", {
                        defaultValue: "校验码错误：该组 6 位数无法被 11 整除",
                        group: idx + 1
                      })
                    : undefined
                }
              />
              {idx < 4 && (
                <span className="text-gray-400 dark:text-gray-500 font-bold select-none text-xs">
                  -
                </span>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {invalidGroupIndices.length > 0 && (
        <p className="text-xs text-red-500 dark:text-red-400 text-center font-medium mt-1">
          {t("auth.recoveryChecksumErrorDesc", {
            defaultValue: "第 {{groups}} 组校验码错误，请核对后重试",
            groups: invalidGroupIndices.map((i) => i + 1).join("、")
          })}
        </p>
      )}
    </div>
  );
};

import * as SwitchPrimitive from "@radix-ui/react-switch";
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <SwitchPrimitive.Root
      aria-label={label}
      className="switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    >
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

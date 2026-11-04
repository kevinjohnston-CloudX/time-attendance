"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/**
 * A form's submit Button that shows itself busy while its form's action
 * runs, read from the form it sits in, so the page needs no state of its own.
 */
export function SubmitButton({ pending, ...props }: Omit<ButtonProps, "type">) {
  const status = useFormStatus();
  return <Button {...props} type="submit" pending={pending || status.pending} />;
}

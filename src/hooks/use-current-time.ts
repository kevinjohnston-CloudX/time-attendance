"use client";

import { useState, useEffect } from "react";

/** Returns a Date that updates every second. */
export function useCurrentTime(): Date {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return time;
}

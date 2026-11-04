"use client";

import { usePathname } from "next/navigation";
import { PhoneListSkeleton } from "@/components/ui/phone-list-skeleton";
import { Bar, SkeletonCard, SkeletonHeader, SkeletonPage, SkeletonTable, SkeletonToolbar } from "./page-skeleton";

/**
 * The loading screen for any portal page that has no loading.tsx of its own.
 *
 * <p>Without it, a click on such a page left the old one on screen until the
 * server had finished, with nothing but the thin bar to say anything was
 * happening. This draws at once, inside the shell (the sidebar and top bar
 * stay put), in the shape of the kind of page that is coming: a form for a
 * page that asks for something, a guide for an article, a list otherwise,
 * which is what most of the portal is. A page with a shape of its own still
 * gets its own loading.tsx, which wins over this one.
 */

type Shape = "list" | "form" | "article";

const FORMS = [/\/new$/, /\/edit$/, /^\/leave\/request$/, /^\/time\/missed-punch$/];

function shapeOf(pathname: string): Shape {
  if (FORMS.some((re) => re.test(pathname))) return "form";
  if (/^\/knowledge-base\/[^/]+$/.test(pathname)) return "article";
  return "list";
}

function FormSkeleton() {
  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <SkeletonCard>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Bar w={[110, 90, 130, 100][i]} h={11} />
            <Bar w="100%" h={36} r={8} />
          </div>
        ))}
      </SkeletonCard>
      <div className="flex justify-end gap-2">
        <Bar w={84} h={32} r={8} />
        <Bar w={120} h={32} r={8} />
      </div>
    </div>
  );
}

function ArticleSkeleton() {
  return (
    <SkeletonCard title={false} padding={28}>
      <Bar w="55%" h={24} r={8} />
      <Bar w="30%" h={11} />
      <div className="h-2" />
      {Array.from({ length: 9 }, (_, i) => (
        <Bar key={i} w={i % 4 === 3 ? "62%" : "100%"} h={12} />
      ))}
    </SkeletonCard>
  );
}

export function RouteSkeleton() {
  const shape = shapeOf(usePathname());
  return (
    <SkeletonPage label="Loading page">
      <div className="ta-phone-only">
        {shape === "list" ? (
          <PhoneListSkeleton faces={false} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2.5 pt-1">
              <Bar w="58%" h={30} r={8} />
              <Bar w="44%" h={14} />
            </div>
            {shape === "form" ? <FormSkeleton /> : <ArticleSkeleton />}
          </div>
        )}
      </div>
      <div className="ta-desktop-only">
        <SkeletonHeader action={shape === "list"} />
        {shape === "list" && (
          <>
            <SkeletonToolbar />
            <SkeletonTable />
          </>
        )}
        {shape === "form" && <FormSkeleton />}
        {shape === "article" && <ArticleSkeleton />}
      </div>
    </SkeletonPage>
  );
}

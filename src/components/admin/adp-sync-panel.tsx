"use client";

import { useState, useTransition } from "react";
import { testAdpConnection, syncAdpEmployees } from "@/actions/adp.actions";

interface Site {
  id: string;
  name: string;
}
interface Department {
  id: string;
  name: string;
  site: { name: string };
}
interface RuleSet {
  id: string;
  name: string;
}

interface SyncStatus {
  isConfigured: boolean;
  lastSyncAt: Date | null;
  lastSyncResult: unknown;
  adpEmployeeCount: number;
}

interface Props {
  status: SyncStatus;
  sites: Site[];
  departments: Department[];
  ruleSets: RuleSet[];
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
const btnPrimaryCls =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const btnSecondaryCls =
  "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300";

export function AdpSyncPanel({ status, sites, departments, ruleSets }: Props) {
  const [isPending, startTransition] = useTransition();
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [syncResult, setSyncResult] = useState<{
    created: number;
    updated: number;
    deactivated: number;
    errors: string[];
    newCredentials: Array<{ name: string; username: string; tempPassword: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default selections
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [deptId, setDeptId] = useState(departments[0]?.id ?? "");
  const [ruleSetId, setRuleSetId] = useState(ruleSets[0]?.id ?? "");

  function handleTestConnection() {
    setError(null);
    setTestResult(null);
    startTransition(async () => {
      const result = await testAdpConnection(undefined as never);
      if (!result.success) {
        setTestResult({ success: false, message: result.error });
        return;
      }
      setTestResult({
        success: true,
        message: `Connected! Found ${result.data.workerCount} workers. Sample: ${result.data.sampleNames.join(", ")}`,
      });
    });
  }

  function handleSync() {
    if (!siteId || !deptId || !ruleSetId) {
      setError("Please select a default site, department, and rule set.");
      return;
    }
    setError(null);
    setSyncResult(null);
    startTransition(async () => {
      const result = await syncAdpEmployees({
        defaultSiteId: siteId,
        defaultDeptId: deptId,
        defaultRuleSetId: ruleSetId,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSyncResult(result.data);
    });
  }

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
          Connection Status
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${
              status.isConfigured ? "bg-green-500" : "bg-zinc-300"
            }`}
          />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {status.isConfigured
              ? "ADP credentials configured"
              : "Not configured — set ADP_CLIENT_ID, ADP_CLIENT_SECRET, ADP_CERT_BASE64, and ADP_KEY_BASE64 in environment variables"}
          </span>
        </div>

        {status.lastSyncAt && (
          <p className="mt-2 text-xs text-zinc-400">
            Last sync: {new Date(status.lastSyncAt).toLocaleString()}
            {" · "}
            {status.adpEmployeeCount} ADP-linked employees
          </p>
        )}

        {status.isConfigured && (
          <div className="mt-4">
            <button
              onClick={handleTestConnection}
              disabled={isPending}
              className={btnSecondaryCls}
            >
              {isPending ? "Testing…" : "Test Connection"}
            </button>
            {testResult && (
              <p
                className={`mt-2 text-sm ${
                  testResult.success
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-500"
                }`}
              >
                {testResult.message}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sync Settings */}
      {status.isConfigured && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
            Sync Settings
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            New employees from ADP will be assigned these defaults. You can edit
            individual employees after sync.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                Default Site
              </label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className={inputCls}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                Default Department
              </label>
              <select
                value={deptId}
                onChange={(e) => setDeptId(e.target.value)}
                className={inputCls}
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.site.name})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">
                Default Rule Set
              </label>
              <select
                value={ruleSetId}
                onChange={(e) => setRuleSetId(e.target.value)}
                className={inputCls}
              >
                {ruleSets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleSync}
              disabled={isPending}
              className={btnPrimaryCls}
            >
              {isPending ? "Syncing…" : "Sync Now"}
            </button>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-500">{error}</p>
          )}
        </div>
      )}

      {/* Sync Results */}
      {syncResult && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
            Sync Results
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-green-50 p-3 text-center dark:bg-green-900/20">
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                {syncResult.created}
              </p>
              <p className="text-xs text-green-600 dark:text-green-500">
                Created
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center dark:bg-blue-900/20">
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {syncResult.updated}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-500">
                Updated
              </p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800">
              <p className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">
                {syncResult.deactivated}
              </p>
              <p className="text-xs text-zinc-500">Deactivated</p>
            </div>
          </div>

          {/* New credentials — shown once */}
          {syncResult.newCredentials.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                New Employee Credentials
              </h3>
              <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                Save these now — temporary passwords are only shown once.
              </p>
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-800">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500">
                        Name
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500">
                        Username
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500">
                        Temp Password
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                    {syncResult.newCredentials.map((cred) => (
                      <tr key={cred.username}>
                        <td className="px-3 py-2 text-zinc-900 dark:text-white">
                          {cred.name}
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">
                          {cred.username}
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">
                          {cred.tempPassword}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Errors */}
          {syncResult.errors.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-red-600">
                Errors ({syncResult.errors.length})
              </h3>
              <ul className="mt-1 space-y-1">
                {syncResult.errors.map((err, i) => (
                  <li
                    key={i}
                    className="text-xs text-red-500 dark:text-red-400"
                  >
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

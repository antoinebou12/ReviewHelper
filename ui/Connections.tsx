import { useEffect, useState } from "react";
import { ExternalLink, LogIn, ShieldCheck, LoaderCircle } from "lucide-react";
import { azureConnection } from "./api";
import type { Review } from "./types";
import { safeLink } from "./types";

export function AzureConnection() {
  const [state, setState] = useState({ configured: false, signed_in: false });
  const [flow, setFlow] = useState<{
    login_id: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    azureConnection("status")
      .then(setState)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await azureConnection("poll", flow.login_id);
        if (cancelled) return;
        if (result.status === "authenticated") {
          setState({ configured: true, signed_in: true });
          setFlow(null);
        } else if (result.status === "pending")
          timer = setTimeout(poll, (result.interval || 5) * 1000);
        else {
          setError(result.message || "Sign-in ended. Start again.");
          setFlow(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setFlow(null);
        }
      }
    };
    timer = setTimeout(poll, flow.interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      setFlow(await azureConnection("start"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="entra-panel" aria-label="Microsoft Entra login">
      <h3>
        <ShieldCheck size={15} /> Azure DevOps with Microsoft Entra
      </h3>
      <p>
        Sign in with your organization account to read protected pull requests.
        Your tenant's access policies apply.
      </p>
      {state.signed_in ? (
        <div className="connected-row">
          <span className="connection-on">Signed in to Microsoft</span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await azureConnection("logout");
                setState({ ...state, signed_in: false });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Sign out locally
          </button>
        </div>
      ) : flow ? (
        <div className="device-flow">
          <p>Enter this code on Microsoft's sign-in page:</p>
          <code aria-label="Microsoft sign-in code">{flow.user_code}</code>
          <a
            className="button primary"
            href={safeLink(flow.verification_uri)}
            target="_blank"
            rel="noreferrer"
          >
            Continue with Microsoft <ExternalLink size={13} />
          </a>
          <span role="status">
            <LoaderCircle size={12} className="spin" /> Waiting for sign-in…
          </span>
          <button className="text-button" onClick={() => setFlow(null)}>
            Stop waiting
          </button>
        </div>
      ) : (
        <>
          <button className="button" disabled={busy} onClick={start}>
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <LogIn size={15} />
            )}{" "}
            Sign in with Microsoft
          </button>
          {!state.configured && (
            <p className="subtle-caption">
              Set AZURE_CLIENT_ID and AZURE_TENANT_ID in the server environment
              first.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function JiraTable({ review }: { review: Review }) {
  return (
    <section className="jira-panel" aria-label="Linked Jira issues">
      <div className="jira-heading">
        <h3>Linked Jira issues</h3>
        <span>PR-wide context</span>
      </div>
      <p>Issues linked in the pull request description or discussion.</p>
      <div className="jira-table-scroll">
        <table className="jira-table">
          <thead>
            <tr>
              <th scope="col">Issue</th>
              <th scope="col">Summary</th>
              <th scope="col">Status</th>
              <th scope="col">Assignee</th>
              <th scope="col">Priority</th>
            </tr>
          </thead>
          <tbody>
            {(review.issues || []).map((issue) => (
              <tr key={issue.url}>
                <td>
                  <a
                    href={safeLink(issue.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {issue.key} <ExternalLink size={11} />
                  </a>
                  <small>{issue.issue_type}</small>
                </td>
                <td>
                  {issue.summary}
                  {issue.note && <small>{issue.note}</small>}
                </td>
                <td>
                  <span className="jira-status">{issue.status}</span>
                </td>
                <td>{issue.assignee || "Not loaded"}</td>
                <td>{issue.priority || "Not loaded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {review.provider === "demo" && (
        <p className="subtle-caption">Fictional Jira data for this example.</p>
      )}
    </section>
  );
}

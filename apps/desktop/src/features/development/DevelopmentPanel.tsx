import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import type {
  Snapshot,
  PlanDetail,
} from "../../../../../packages/contracts/src/index";
type Perform = (fn: () => Promise<any>, message?: string) => Promise<any>;
export function DevelopmentPanel({
  data,
  perform,
}: {
  data: Snapshot;
  perform: Perform;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<PlanDetail | null>(null),
    [image, setImage] = useState<string | null>(null),
    [report, setReport] = useState("");
  const plans = data.plans ?? [];
  useEffect(() => {
    const plan = plans.find((p) => p.id === selected);
    if (!plan) {
      setDetail(null);
      return;
    }
    let active = true;
    window.studio
      .getPlan({ workspaceId: plan.workspaceId, planId: plan.id })
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch(() => {
        if (active) setDetail(null);
      });
    return () => {
      active = false;
    };
  }, [selected, data]);
  return (
    <section className="development-panel" aria-label="Development plans">
      <div className="development-heading">
        <div>
          <h2>Development plans</h2>
          <p>
            Follow implementation, verification, and the evidence behind each
            result.
          </p>
        </div>
        <span>
          {plans.length} {plans.length === 1 ? "plan" : "plans"}
        </span>
      </div>
      {!plans.length ? (
        <p className="development-empty">
          Plans from your connected assistant will appear here.
        </p>
      ) : (
        <div className="development-columns">
          <div className="development-plan-list">
            {plans.map((p) => (
              <button
                key={p.id}
                className={selected === p.id ? "selected" : ""}
                onClick={() => setSelected(p.id)}
              >
                <strong>{p.title}</strong>
                <span>
                  {p.mode} ·{" "}
                  {detail?.plan.id === p.id ? detail.plan.status : p.status}
                </span>
              </button>
            ))}
          </div>
          <div>
            {detail ? (
              <>
                <div className="development-heading">
                  <div>
                    <h3>{detail.plan.title}</h3>
                    <p>
                      {detail.progress.completed} of {detail.progress.total}{" "}
                      tasks verified
                    </p>
                  </div>
                  <div className="development-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void perform(() =>
                          window.studio.getPlan({
                            workspaceId: detail.plan.workspaceId,
                            planId: detail.plan.id,
                            refresh: true,
                          }),
                        ).then((result) => {
                          if (result) setDetail(result);
                        })
                      }
                    >
                      Refresh evidence
                    </Button>
                    {(["resume", "pause", "cancel"] as const).map((action) => (
                      <Button
                        key={action}
                        variant="secondary"
                        size="sm"
                        disabled={
                          detail.plan.status === "cancelled" ||
                          (action === "pause" &&
                            detail.plan.status !== "active")
                        }
                        onClick={() =>
                          void perform(() =>
                            window.studio.controlPlan({
                              workspaceId: detail.plan.workspaceId,
                              planId: detail.plan.id,
                              revision: detail.plan.revision,
                              action,
                            }),
                          ).then((d) => {
                            if (d) setDetail(d);
                          })
                        }
                      >
                        {action === "resume"
                          ? "Resume"
                          : action === "pause"
                            ? "Pause"
                            : "Cancel plan"}
                      </Button>
                    ))}
                  </div>
                </div>
                {detail.plan.designBrief && (
                  <details>
                    <summary>Design brief</summary>
                    <p>{detail.plan.designBrief}</p>
                  </details>
                )}
                <ol className="development-tasks">
                  {detail.tasks.map((t) => (
                    <li key={t.id}>
                      <div>
                        <strong>{t.title}</strong>
                        <span
                          className={"development-status status-" + t.status}
                        >
                          {t.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      {t.description && <p>{t.description}</p>}
                      {t.error && (
                        <p role="status" className="development-error">
                          {t.error}
                        </p>
                      )}
                      {t.dependsOn.length > 0 && (
                        <small>After: {t.dependsOn.join(", ")}</small>
                      )}
                      {detail.verifications
                        .filter((v) => v.taskId === t.id)
                        .slice(0, 5)
                        .map((v) => (
                          <p key={v.id} className="development-check">
                            {v.status} · {v.criterion.kind.replaceAll("_", " ")}{" "}
                            · {v.detail}
                          </p>
                        ))}
                      {t.assessment && (
                        <details>
                          <summary>Design assessment</summary>
                          <p>{t.assessment}</p>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
                {detail.artifacts.length > 0 && (
                  <>
                    <h3>Evidence</h3>
                    <div className="development-evidence">
                      {detail.artifacts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() =>
                            void perform(() =>
                              window.studio.getArtifact({
                                workspaceId: a.workspaceId,
                                artifactId: a.id,
                              }),
                            ).then((r) => {
                              if (r?.image)
                                setImage(
                                  "data:" +
                                    r.image.mimeType +
                                    ";base64," +
                                    r.image.data,
                                );
                              else if (r?.content) setReport(r.content);
                            })
                          }
                        >
                          <strong>{a.name}</strong>
                          <span>
                            {a.role} ·{" "}
                            {a.width
                              ? `${a.width} × ${a.height}`
                              : `${a.bytes} bytes`}
                          </span>
                          <small>
                            {new Date(a.createdAt).toLocaleString()}
                          </small>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="development-empty">
                Select a plan to inspect tasks and evidence.
              </p>
            )}
          </div>
        </div>
      )}
      <Dialog
        open={!!image || !!report}
        onOpenChange={(open) => {
          if (!open) {
            setImage(null);
            setReport("");
          }
        }}
        title="Execution evidence"
      >
        {image ? (
          <img
            className="development-image"
            src={image}
            alt="Actual captured execution evidence"
          />
        ) : (
          <pre className="development-report">{report}</pre>
        )}
      </Dialog>
    </section>
  );
}
export function SkillsPanel({
  data,
  perform,
}: {
  data: Snapshot;
  perform: Perform;
}) {
  const [workspaceId, setWorkspaceId] = useState(""),
    [github, setGithub] = useState(false),
    [url, setUrl] = useState(""),
    [commit, setCommit] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [content, setContent] = useState(""),
    [replaceSkillId, setReplaceSkillId] = useState<string | undefined>();
  const skills = data.skills ?? [];
  return (
    <section className="development-panel" aria-label="Agent Skills">
      <div className="development-heading">
        <div>
          <h2>Agent Skills</h2>
          <p>
            Import instructions and resources. Script execution requires
            authorization for the exact version.
          </p>
        </div>
      </div>
      <div className="development-actions">
        <label>
          Scope{" "}
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            <option value="">Global</option>
            {data.workspaces
              .filter((w) => w.enabled)
              .map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </label>
        {(["directory", "zip"] as const).map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            onClick={() =>
              void perform(
                () =>
                  window.studio.importSkills({
                    kind,
                    workspaceId: workspaceId || undefined,
                  }),
                "Skill imported disabled. Review before enabling.",
              )
            }
          >
            {kind === "directory" ? "Import folder" : "Import ZIP"}
          </Button>
        ))}
        <Button
          variant="secondary"
          onClick={() => {
            setReplaceSkillId(undefined);
            setGithub(true);
          }}
        >
          Import from GitHub
        </Button>
      </div>
      {!skills.length ? (
        <p className="development-empty">No imported skills.</p>
      ) : (
        <div className="development-evidence">
          {skills.map((s) => (
            <article className="development-skill" key={s.id}>
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <small>
                {s.scope} · {s.hash.slice(0, 12)} ·{" "}
                {s.enabled ? "Enabled" : "Disabled"}
              </small>
              <div className="development-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void perform(() =>
                      window.studio.configureSkill({
                        skillId: s.id,
                        enabled: !s.enabled,
                      }),
                    )
                  }
                >
                  {s.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSelected(s.id);
                    setContent("");
                  }}
                >
                  Inspect resources
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={s.authorizedHash === s.hash}
                  onClick={() =>
                    void perform(() =>
                      window.studio.configureSkill({
                        skillId: s.id,
                        authorize: true,
                      }),
                    )
                  }
                >
                  {s.authorizedHash === s.hash
                    ? "Scripts authorized"
                    : "Authorize scripts"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (s.source.startsWith("https://github.com/")) {
                      setReplaceSkillId(s.id);
                      setUrl(s.source);
                      setCommit("");
                      setGithub(true);
                    } else
                      void perform(
                        () =>
                          window.studio.importSkills({
                            kind: s.source.startsWith("zip")
                              ? "zip"
                              : "directory",
                            replaceSkillId: s.id,
                          }),
                        "Updated skill imported. Changed scripts require new authorization.",
                      );
                  }}
                >
                  Update version
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void perform(() =>
                      window.studio.configureSkill({
                        skillId: s.id,
                        uninstall: true,
                      }),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={github}
        onOpenChange={setGithub}
        title="Import a pinned GitHub skill"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              () =>
                window.studio.importSkills({
                  kind: "github",
                  url,
                  commit,
                  workspaceId: workspaceId || undefined,
                  replaceSkillId,
                }),
              "Skill imported disabled.",
            ).then((r) => {
              if (r) setGithub(false);
            });
          }}
        >
          <label>
            Repository URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
              required
            />
          </label>
          <label>
            Commit SHA
            <input
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              minLength={40}
              maxLength={40}
              required
            />
          </label>
          <Button type="submit">Import pinned version</Button>
        </form>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="Skill resources"
      >
        <div className="development-resource-list">
          {skills
            .find((s) => s.id === selected)
            ?.files.map((f) => (
              <button
                key={f.path}
                onClick={() =>
                  void perform(() =>
                    window.studio.inspectSkill({
                      skillId: selected!,
                      resource: f.path,
                    }),
                  ).then((r) => {
                    if (r)
                      setContent(
                        r.encoding === "base64"
                          ? "Binary resource · " + r.hash
                          : r.content,
                      );
                  })
                }
              >
                {f.path} · {f.bytes} bytes
              </button>
            ))}
        </div>
        <pre className="development-report">{content}</pre>
      </Dialog>
    </section>
  );
}

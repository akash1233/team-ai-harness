import { createServerFn } from "@tanstack/react-start";
import type { GithubConnection, JiraConnection } from "./connectors";

export const testJiraConnection = createServerFn({ method: "POST" })
  .validator((input: { jira: JiraConnection }) => input)
  .handler(async ({ data }) => {
    const { probeJira } = await import("./connectors.server");
    return probeJira(data.jira);
  });

export const syncJiraIssues = createServerFn({ method: "POST" })
  .validator((input: { jira: JiraConnection }) => input)
  .handler(async ({ data }) => {
    const { listJiraIssues } = await import("./connectors.server");
    return listJiraIssues(data.jira);
  });

export const pullJiraIssue = createServerFn({ method: "POST" })
  .validator((input: { jira: JiraConnection; key: string }) => input)
  .handler(async ({ data }) => {
    const { getJiraIssue } = await import("./connectors.server");
    return getJiraIssue(data.jira, data.key);
  });

export const testGithubConnection = createServerFn({ method: "POST" })
  .validator((input: { github: GithubConnection }) => input)
  .handler(async ({ data }) => {
    const { probeGithub } = await import("./connectors.server");
    return probeGithub(data.github);
  });

export const syncGithubRepos = createServerFn({ method: "POST" })
  .validator((input: { github: GithubConnection }) => input)
  .handler(async ({ data }) => {
    const { listGithubRepos } = await import("./connectors.server");
    return listGithubRepos(data.github);
  });

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  chatMarkdown: vi.fn(),
}));

vi.mock("../ChatMarkdown", () => ({
  default: (props: unknown) => {
    mocks.chatMarkdown(props);
    return <div />;
  },
}));

import { PullRequestMarkdown, PullRequestThreadRefProvider } from "./PullRequestMarkdown";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const THREAD_REF = {
  environmentId: ENVIRONMENT_ID,
  threadId: ThreadId.make("thread-1"),
};

describe("pull request markdown", () => {
  beforeEach(() => {
    mocks.chatMarkdown.mockClear();
  });

  it("passes the owning thread to links rendered inside a thread panel", () => {
    renderToStaticMarkup(
      <PullRequestThreadRefProvider threadRef={THREAD_REF}>
        <PullRequestMarkdown
          text="[Related pull request](https://github.com/pingdotgg/t3code/pull/6446)"
          cwd="/workspace"
          environmentId={ENVIRONMENT_ID}
        />
      </PullRequestThreadRefProvider>,
    );

    expect(mocks.chatMarkdown).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ environmentId: ENVIRONMENT_ID, threadRef: THREAD_REF }),
    );
  });

  it("leaves links unscoped on the pull requests page", () => {
    renderToStaticMarkup(
      <PullRequestMarkdown
        text="[Related pull request](https://github.com/pingdotgg/t3code/pull/6446)"
        cwd="/workspace"
        environmentId={ENVIRONMENT_ID}
      />,
    );

    expect(mocks.chatMarkdown).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ environmentId: ENVIRONMENT_ID, threadRef: undefined }),
    );
  });
});

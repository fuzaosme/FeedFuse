import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { defaultPersistedSettings } from "../../../../features/settings/settingsSchema";
import type { SettingsDraft } from "../../../../store/settingsStore";
import AISettingsPanel from "../../../../features/settings/panels/AISettingsPanel";

function createInitialDraft(): SettingsDraft {
  return {
    persisted: structuredClone(defaultPersistedSettings),
    session: {
      ai: {
        apiKey: "",
        hasApiKey: false,
        clearApiKey: false,
      },
      rssValidation: {},
    },
  } as SettingsDraft;
}

function Harness() {
  const [draft, setDraft] = useState<SettingsDraft>(createInitialDraft());

  return (
    <AISettingsPanel
      draft={draft}
      onChange={(updater) => {
        setDraft((current) => {
          const next = structuredClone(current);
          updater(next);
          return next;
        });
      }}
      errors={{}}
    />
  );
}

describe("AISettingsPanel", () => {
  it("defaults translation to shared AI config and reveals dedicated key fields when disabled", async () => {
    render(<Harness />);

    expect(
      screen.queryByText("填写用于摘要与翻译的模型名称，例如 gpt-4o-mini。"),
    ).not.toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText("查看 AI 模型 说明"));
    await waitFor(() => {
      expect(
        screen.getAllByText("填写用于摘要与翻译的模型名称，例如 gpt-4o-mini。")
          .length,
      ).toBeGreaterThan(0);
    });

    expect(screen.getByText("翻译配置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复用主配置" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText("翻译 API 密钥")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "单独配置" }));

    expect(screen.getByLabelText("翻译模型")).toBeInTheDocument();
    expect(screen.getByLabelText("翻译 API 地址")).toBeInTheDocument();
    expect(screen.getByLabelText("翻译 API 密钥")).toBeInTheDocument();
  });

  it("allows editing summary and translation prompts", () => {
    render(<Harness />);

    const summaryPrompt = screen.getByLabelText("摘要提示词");
    const translationPrompt = screen.getByLabelText("翻译提示词");

    fireEvent.change(summaryPrompt, { target: { value: "请输出两条要点" } });
    fireEvent.change(translationPrompt, { target: { value: "请保留术语英文" } });

    expect((summaryPrompt as HTMLTextAreaElement).value).toBe("请输出两条要点");
    expect((translationPrompt as HTMLTextAreaElement).value).toBe("请保留术语英文");
  });

  it("shows the built-in prompts for every empty fallback field and toggles them with more/less", () => {
    render(<Harness />);

    // 三个使用内置兜底模板的提示词都要能看见，且默认折叠不占满页面。
    expect(screen.getAllByText(/内置默认提示词/)).toHaveLength(3);
    expect(screen.queryByRole("region", { name: "内置默认提示词内容" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "展开内置默认提示词 more" })[1]);
    expect(screen.getByRole("region", { name: "内置默认提示词内容" })).toHaveTextContent("英语精读助手");

    fireEvent.click(screen.getByRole("button", { name: "收起内置默认提示词 less" }));
    expect(screen.queryByRole("region", { name: "内置默认提示词内容" })).not.toBeInTheDocument();
  });

  it("marks the built-in prompt as inactive once the user writes a custom one", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("翻译提示词"), { target: { value: "自定义翻译" } });

    expect(screen.getByText("内置默认提示词（已自定义，当前未生效）")).toBeInTheDocument();
    expect(screen.getAllByText("内置默认提示词（留空时生效）")).toHaveLength(2);
  });

  it("allows toggling deep thinking", () => {
    render(<Harness />);

    const toggle = screen.getByRole("switch", { name: "启用深度思考" });
    const deepThinkingRow = toggle.closest("div[class*='justify-between']");
    const summaryPromptLabel = screen.getByText("摘要提示词");
    const translationConfigLabel = screen.getByText("翻译配置");

    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(deepThinkingRow).not.toHaveClass("border", "border-border", "rounded-md");
    expect(
      summaryPromptLabel.compareDocumentPosition(translationConfigLabel),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-state", "checked");
  });
});

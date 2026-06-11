/** Click-to-open recovery-instructions popover + button trigger for
 *  `PrResult.kind === "unavailable"`. Dispatch happens in two layers:
 *  `ProviderUnavailableContent` matches on `source.provider`, delegating
 *  to a per-provider content component so each forge's recovery UX
 *  doesn't need to fit a shared mold. Anchored positioning comes from
 *  `useAnchoredPopover`. */

import type { GhUnavailableCode } from "kolu-github/schemas";
import type { ForgejoUnavailableCode } from "kolu-forgejo/schemas";
import type { PrUnavailableSource } from "kolu-common/surface";
import { reasonForSource } from "kolu-common/surface";
import { For, type Component, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { writeTextToClipboard } from "../ui/clipboard";
import { WarningIcon } from "../ui/Icons";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";

/** Per-code recovery content — the shape every `*UnavailableContent`
 *  renderer projects to. Either a copy-to-clipboard command (with the
 *  post-copy helper text) or a free-form body of paragraphs. The shape
 *  is forge-neutral; only the per-forge table values differ. */
type RecoveryEntry = {
  title: string;
  /** Renderable body — a paragraph can be a string or a copy command. */
  body: (Paragraph | CopyCommandEntry)[];
};
type Paragraph = { kind: "p"; text: string };
type CopyCommandEntry = { kind: "copy"; command: string; after?: string };

const GH_RECOVERY: Record<GhUnavailableCode, RecoveryEntry> = {
  "not-authenticated": {
    title: "GitHub not authenticated",
    body: [
      {
        kind: "p",
        text: "Kolu reads PRs via gh. Run this once in any terminal:",
      },
      {
        kind: "copy",
        command: "gh auth login -s repo,read:org",
        after:
          "Scopes repo and read:org cover private repos and org-owned PRs.",
      },
    ],
  },
  "not-installed": {
    title: "GitHub CLI not installed",
    body: [
      {
        kind: "p",
        text: "Kolu reads PRs via gh. Install it from cli.github.com and relaunch kolu.",
      },
      {
        kind: "p",
        text: "Nix installs bundle gh automatically — if you see this, the wrapper isn't in use.",
      },
    ],
  },
  "timed-out": {
    title: "GitHub timed out",
    body: [
      {
        kind: "p",
        text: "gh pr view took longer than 5s. Kolu will retry on the next branch change or polling tick.",
      },
    ],
  },
  unknown: {
    title: "GitHub lookup failed",
    body: [
      {
        kind: "p",
        text: "An unrecognized error from gh. Check kolu server logs for details; kolu will retry on the next branch change.",
      },
    ],
  },
};

const FORGEJO_RECOVERY: Record<ForgejoUnavailableCode, RecoveryEntry> = {
  "not-authenticated": {
    title: "Forgejo not authenticated",
    body: [
      {
        kind: "p",
        text: "Kolu reads PRs from Forgejo/Codeberg via fj. Run this once in any terminal:",
      },
      {
        kind: "copy",
        command: "fj auth login",
        after:
          "Self-hosted instances need fj auth login --host <url>. Alternatively, set KOLU_FORGEJO_TOKEN.",
      },
    ],
  },
  "not-found": {
    title: "Forgejo PR not found",
    body: [
      {
        kind: "p",
        text: "The repository or PR doesn't exist on this Forgejo instance. Check that the remote URL points to the correct host and that the PR hasn't been deleted.",
      },
    ],
  },
  "timed-out": {
    title: "Forgejo timed out",
    body: [
      {
        kind: "p",
        text: "The Forgejo API request took longer than 5s. Kolu will retry on the next branch change or polling tick.",
      },
    ],
  },
  unknown: {
    title: "Forgejo lookup failed",
    body: [
      {
        kind: "p",
        text: "An unrecognized error from the Forgejo API. Check kolu server logs for details; kolu will retry on the next branch change.",
      },
    ],
  },
};

export const ProviderUnavailableContent: Component<{
  source: PrUnavailableSource;
}> = (props) =>
  match(props.source)
    .with({ provider: "gh" }, ({ code }) => (
      <RecoveryContent entry={GH_RECOVERY[code]} />
    ))
    .with({ provider: "forgejo" }, ({ code }) => (
      <RecoveryContent entry={FORGEJO_RECOVERY[code]} />
    ))
    .exhaustive();

/** Renderer for one recovery entry — paragraphs and copy commands. The
 *  copy button gets its own open-state signal so the two providers share
 *  the render and the clipboard UX. */
const RecoveryContent: Component<{ entry: RecoveryEntry }> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const copy = async (text: string) => {
    try {
      await writeTextToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(`Couldn't copy: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <div class="font-medium text-fg">{props.entry.title}</div>
      <For each={props.entry.body}>
        {(block) => {
          if (block.kind === "p") {
            return (
              <p class="text-fg-2 leading-relaxed">
                {parseInlineCode(block.text)}
              </p>
            );
          }
          return (
            <>
              <CopyCommand
                command={block.command}
                copied={copied()}
                onCopy={() => copy(block.command)}
              />
              {block.after && (
                <p class="text-fg-3 leading-relaxed">
                  {parseInlineCode(block.after)}
                </p>
              )}
            </>
          );
        }}
      </For>
    </>
  );
};

/** Render a string that may contain backtick-delimited code spans as a
 *  mix of text and `<code>` elements. Single-backtick spans only. */
function parseInlineCode(
  text: string,
): (string | import("solid-js").JSX.Element)[] {
  const parts = text.split(/(`[^`]+`)/);
  return parts.map((p) => {
    if (p.startsWith("`") && p.endsWith("`")) {
      return <code class="font-mono">{p.slice(1, -1)}</code>;
    }
    return p;
  });
}

const PrUnavailablePopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: HTMLElement;
  source: PrUnavailableSource;
}> = (props) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-start",
    panelMinWidth: 280,
  });

  const chrome = surface({ radius: "xl", portalled: true });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="pr-unavailable-popover"
          role="dialog"
          aria-label={reasonForSource(props.source)}
          class={`fixed z-50 ${chrome.class} p-3 w-[280px] space-y-2 text-xs`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <ProviderUnavailableContent source={props.source} />
        </div>
      </Portal>
    </Show>
  );
};

const CopyCommand: Component<{
  command: string;
  copied: boolean;
  onCopy: () => void;
}> = (props) => (
  <button
    type="button"
    onClick={props.onCopy}
    class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 font-mono text-[11px] text-fg cursor-pointer transition-colors"
    data-testid="pr-unavailable-copy"
  >
    <span class="truncate">{props.command}</span>
    <span class="shrink-0 text-fg-3 text-[10px]">
      {props.copied ? "copied" : "copy"}
    </span>
  </button>
);

/** ⚠ button + its popover, one component per render site. Owns its own
 *  open-state signal and trigger ref — canvas tile chrome and mobile
 *  pull-handle show the icon for the same terminal simultaneously and each
 *  must anchor their popover to their own trigger rather than share one. */
export const PrUnavailableButton: Component<{
  source: PrUnavailableSource;
  testId: string;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [triggerEl, setTriggerEl] = createSignal<HTMLButtonElement>();
  const reason = () => reasonForSource(props.source);
  return (
    <>
      <button
        ref={setTriggerEl}
        type="button"
        data-testid={props.testId}
        class="flex items-center text-fg-3 shrink-0 cursor-pointer hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
        title={reason()}
        aria-label={reason()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <WarningIcon class="w-3 h-3" />
      </button>
      <PrUnavailablePopover
        open={open()}
        onOpenChange={setOpen}
        triggerRef={triggerEl()}
        source={props.source}
      />
    </>
  );
};

export default PrUnavailablePopover;

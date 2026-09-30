import * as React from "react";
import { ArrowDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MessageScrollerContextValue = {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  atEnd: boolean;
  refresh: () => void;
  scrollToEnd: () => void;
};

const MessageScrollerContext = React.createContext<MessageScrollerContextValue | null>(null);

function useMessageScrollerContext() {
  const context = React.useContext(MessageScrollerContext);
  if (!context) throw new Error("MessageScroller components must be used inside MessageScrollerProvider");
  return context;
}

function MessageScrollerProvider({ children }: { children: React.ReactNode }) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [atEnd, setAtEnd] = React.useState(true);

  const refresh = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setAtEnd(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 8);
  }, []);

  const scrollToEnd = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, []);

  const value = React.useMemo(() => ({ viewportRef, atEnd, refresh, scrollToEnd }), [atEnd, refresh, scrollToEnd]);

  return <MessageScrollerContext.Provider value={value}>{children}</MessageScrollerContext.Provider>;
}

function MessageScroller({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-scroller"
      className={cn("group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  );
}

function MessageScrollerViewport({ className, onScroll, ref, ...props }: React.ComponentProps<"div">) {
  const { viewportRef, refresh } = useMessageScrollerContext();

  return (
    <div
      ref={(node) => {
        viewportRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content",
        className
      )}
      onScroll={(event) => {
        refresh();
        onScroll?.(event);
      }}
      {...props}
    />
  );
}

function MessageScrollerContent({ className, children, ...props }: React.ComponentProps<"div">) {
  const { refresh } = useMessageScrollerContext();

  React.useLayoutEffect(() => {
    refresh();
  }, [children, refresh]);

  return (
    <div data-slot="message-scroller-content" className={cn("flex h-max min-h-full flex-col gap-6", className)} {...props}>
      {children}
    </div>
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor: _scrollAnchor = false,
  ...props
}: React.ComponentProps<"div"> & { scrollAnchor?: boolean }) {
  return (
    <div
      data-slot="message-scroller-item"
      className={cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]", className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  variant = "secondary",
  size = "icon-sm",
  onClick,
  ...props
}: React.ComponentProps<typeof Button> & { direction?: "start" | "end"; render?: React.ReactNode }) {
  const { atEnd, scrollToEnd } = useMessageScrollerContext();
  const active = direction === "end" ? !atEnd : false;

  return (
    <Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-active={active}
      data-variant={variant}
      data-size={size}
      variant={variant}
      size={size}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
        className
      )}
      onClick={(event) => {
        if (direction === "end") scrollToEnd();
        onClick?.(event);
      }}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">{direction === "end" ? "Scroll to end" : "Scroll to start"}</span>
        </>
      )}
    </Button>
  );
}

function useMessageScroller() {
  return useMessageScrollerContext();
}

function useMessageScrollerScrollable() {
  const { atEnd } = useMessageScrollerContext();
  return !atEnd;
}

function useMessageScrollerVisibility() {
  const { atEnd } = useMessageScrollerContext();
  return !atEnd;
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};

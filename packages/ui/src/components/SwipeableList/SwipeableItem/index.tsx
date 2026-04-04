import { useCallback, useEffect, useRef } from "react";
import {
  motion,
  useDragControls,
  useMotionValue,
  animate,
} from "framer-motion";
import { cn } from "../../../lib/utils";
import { Button } from "../../../button.tsx";
import { SwipeableItemProps } from "./Types.ts";

let currentOpenItem: (() => void) | null = null;

export function SwipeableItem<T>({
  children,
  actions,
  disabled = false,
  item,
}: Readonly<SwipeableItemProps<T>>) {
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const actionsRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    animate(x, 0, { type: "spring", stiffness: 400, damping: 40 });
    currentOpenItem = null;
  }, [x]);

  useEffect(() => {
    const closeIfOpen = () => {
      if (currentOpenItem && currentOpenItem !== close) {
        currentOpenItem();
      }
    };
    window.addEventListener("pointerdown", closeIfOpen);
    return () => window.removeEventListener("pointerdown", closeIfOpen);
  }, [close]);

  const handleDragEnd = (_: unknown, info: { velocity: { x: number } }) => {
    const actionsWidth = actionsRef.current?.offsetWidth || 0;
    if (info.velocity.x < -200 || x.get() < -actionsWidth / 2) {
      animate(x, -actionsWidth, {
        type: "spring",
        stiffness: 400,
        damping: 40,
      });
      currentOpenItem = close;
    } else {
      close();
    }
  };

  return (
    <motion.div
      className="relative w-full overflow-hidden"
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div
        ref={actionsRef}
        className="absolute right-0 top-0 h-full flex items-stretch"
      >
        {actions.map((action, index) => (
          <Button
            key={index}
            variant={action.variant ?? (index === 0 ? "danger" : "secondary")}
            className={cn("h-full rounded-none", action.className)}
            onClick={() => {
              if (item !== undefined) {
                action.onClick?.({ ...item, index });
              }
              close();
            }}
          >
            {action.icons}
            {action.label}
          </Button>
        ))}
      </div>

      <motion.div
        drag={disabled ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        dragControls={dragControls}
        style={{ x }}
        onDragEnd={handleDragEnd}
        className="relative w-full bg-background cursor-grab active:cursor-grabbing"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

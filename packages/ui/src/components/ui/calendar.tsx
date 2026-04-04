/* eslint-disable react/prop-types */
import * as React from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { DayButton, DayPicker } from "react-day-picker";

import { cn } from "../../lib/utils";
import { Button, buttonVariants } from "./button";

type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
};

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn("p-3 text-gray-900", className)}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("text-gray-900", classNames?.root),
        months: "flex flex-row space-x-4 space-y-0",
        month: "flex w-full flex-col gap-4",
        nav: "inset-x-0 top-0 flex w-full items-center justify-between gap-1",
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-8 w-8 select-none rounded-full p-0 aria-disabled:opacity-40",
          "bg-white hover:bg-gray-100 border border-gray-200",
          classNames?.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-8 w-8 select-none rounded-full p-0 aria-disabled:opacity-40",
          "bg-white hover:bg-gray-100 border border-gray-200",
          classNames?.button_next,
        ),
        month_caption:
          "flex h-8 w-full items-center justify-center px-8 text-sm font-medium",
        dropdowns:
          "flex h-8 w-full items-center justify-center gap-1.5 text-sm font-medium",
        dropdown_root:
          "relative rounded-md border border-gray-200 bg-white has-focus:ring-primary-500/50 has-focus:ring-[3px]",
        dropdown: "absolute inset-0 opacity-0",
        caption_label:
          "select-none text-sm font-medium text-gray-900 flex items-center gap-1",
        table: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "flex-1 select-none rounded-md text-[0.75rem] font-normal text-gray-500",
        week: "mt-2 flex w-full",
        day: "relative w-8 h-8 p-0 text-center",
        today:
          "rounded-md border border-primary-200 bg-primary-50 text-primary-700",
        outside: "text-gray-300 aria-selected:text-gray-300",
        disabled: "text-gray-300 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => (
          <div
            data-slot="calendar"
            ref={rootRef}
            className={cn(className)}
            {...props}
          />
        ),
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left")
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            );
          if (orientation === "right")
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            );
          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          );
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  modifiers,
  disabled,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  const isSingleSelected =
    modifiers.selected &&
    !modifiers.range_start &&
    !modifiers.range_end &&
    !modifiers.range_middle;

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      disabled={disabled}
      data-selected-single={isSingleSelected}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-xs font-normal",
        "text-gray-900 hover:bg-gray-100",
        "disabled:opacity-40 disabled:hover:bg-transparent",

        // 单选选中
        "data-[selected-single=true]:bg-primary-500 data-[selected-single=true]:text-white",

        // 区间
        "data-[range-middle=true]:bg-primary-100 data-[range-middle=true]:text-primary-700",
        "data-[range-start=true]:bg-primary-500 data-[range-start=true]:text-white",
        "data-[range-end=true]:bg-primary-500 data-[range-end=true]:text-white",

        //  焦点：别用 group-data，直接用 modifiers.focused
        modifiers.focused && "ring-2 ring-primary-500/60 relative z-10",

        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };

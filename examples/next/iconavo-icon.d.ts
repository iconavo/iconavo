// The <iconavo-icon> tag in JSX: React 19 passes these as attributes.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "iconavo-icon": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        icon: string;
        width?: string;
        height?: string;
        color?: string;
        label?: string;
      };
    }
  }
}

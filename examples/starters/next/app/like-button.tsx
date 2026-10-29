"use client";

import { Icon } from "@iconavo-ui/react";
import { useState } from "react";

export function LikeButton() {
  const [liked, setLiked] = useState(false);
  return (
    <button type="button" aria-pressed={liked} onClick={() => setLiked(!liked)}>
      <Icon
        icon={liked ? "ph:heart-fill" : "ph:heart"}
        color={liked ? "crimson" : undefined}
      />{" "}
      Like
    </button>
  );
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase/client";

/** Open Graph data for a web link, from the host's `link-preview` edge function (cached server-side). */
export interface LinkPreview {
  url: string;
  /** false when the page couldn't be fetched or had nothing worth previewing. */
  ok: boolean;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  /** og:type ("website", "article", "video.other", …); null on previews cached before it was read. */
  type?: string | null;
  /** The page's icon (apple-touch-icon or favicon), for pages without an og:image; null when it names none. */
  icon_url?: string | null;
}

export function useLinkPreview(url: string | null) {
  return useQuery({
    queryKey: ["link-preview", url],
    enabled: !!url,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("link-preview", { body: { url } });
      if (error) throw error;
      return data as LinkPreview;
    },
  });
}

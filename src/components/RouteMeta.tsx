import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE = "https://pulse.lungilemooketsi.engineer";

/** Points the canonical tag at the page being shown, so each route is its own page to search engines. */
const RouteMeta = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const url = `${SITE}${pathname}`;
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", url);
    document.querySelector('meta[property="og:url"]')?.setAttribute("content", url);
  }, [pathname]);

  return null;
};

export default RouteMeta;

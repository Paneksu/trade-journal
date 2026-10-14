import type { MetadataRoute } from "next";

/*
 * Aplikacja prywatna (ADR-031): nic do indeksowania. Obok nagłówka
 * `X-Robots-Tag: noindex` i metatagu `robots` w layoucie.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

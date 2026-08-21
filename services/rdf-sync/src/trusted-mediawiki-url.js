const HOSTS = new Set(["127.0.0.1", "wikibase", "japan-wikibase.jwb-instance-local-01.svc.cluster.local"]);
export function trustedMediaWikiUrl(value,{api=false}={}){const url=new URL(value);if(url.protocol!=="http:"||!HOSTS.has(url.hostname)||url.username||url.password||(api&&url.pathname!=="/api.php"))throw new Error("MediaWiki URL is not in the fixed local runtime allowlist");return url;}

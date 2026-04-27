import { getSettings } from "utils/config/config";
import getServiceWidget, { getServiceItem } from "utils/config/service-helpers";
import { identityAllow, readIdentitySettings } from "utils/identity/identity-helpers";
import createLogger from "utils/logger";
import { formatApiCall } from "utils/proxy/api-helpers";
import genericProxyHandler from "utils/proxy/handlers/generic";
import calendarProxyHandler from "widgets/calendar/proxy";
import widgets from "widgets/widgets";

const logger = createLogger("servicesProxy");

export class ResponseFilter {
  constructor(res, paths) {
    this.res = res;
    this.paths = paths;

    ["status", "setHeader"].forEach((key) => {
      this[key] = (...args) => {
        this.res[key](...args);
        return this;
      };
    });
  }

  json(body) {
    // Decode body.
    if (body instanceof Buffer) {
      body = body.toString("utf-8");
    }
    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    // Filter body & send response.
    this.res.json(ResponseFilter.filter(body, this.paths));
  }

  send(body) {
    this.json(body);
  }

  write() {
    throw new Error("Unsupported");
  }

  static filter(value, paths) {
    if (Array.isArray(value)) {
      const invalidPaths = paths.filter((path) => !path.startsWith("*."));
      if (invalidPaths.length > 0) {
        throw new Error(`Non-array paths (${JSON.stringify(invalidPaths)}) for array value.`);
      }

      const subPaths = paths.map((path) => path.substring(2));
      return value.map((item) => ResponseFilter.filter(item, subPaths));
    } else if (typeof value === "object" && value !== null) {
      const invalidPaths = paths.filter((path) => path.startsWith("*."));
      if (invalidPaths.length > 0) {
        throw new Error(`Array paths (${JSON.stringify(invalidPaths)}) for object value.`);
      }

      const result = {};
      for (const [key, item] of Object.entries(value)) {
        if (paths.includes(key)) {
          result[key] = item;
        } else {
          const subPaths = paths
            .filter((path) => path.startsWith(`${key}.`))
            .map((path) => path.substring(key.length + 1));
          if (subPaths.length > 0) {
            result[key] = ResponseFilter.filter(item, subPaths);
          }
        }
      }
      return result;
    }
    throw new Error(`Subpaths (${JSON.stringify(paths)}) for scalar value ${value}.`);
  }
}

export default async function handler(req, res) {
  try {
    const { service, group, index } = req.query;
    const serviceWidget = await getServiceWidget(group, service, index);
    let type = serviceWidget?.type;

    // validate that the user is allowed to view this service/widget.
    const { provider } = readIdentitySettings(getSettings().identity);
    const perms = provider.getIdentity(req);
    if (!identityAllow(perms, await getServiceItem(group, service)) || !identityAllow(perms, serviceWidget)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    // exceptions
    if (type === "calendar") type = "ical";
    else if (service === "unifi_console" && group === "unifi_console") type = "unifi_console";

    const widget = widgets[type];

    if (!widget) {
      logger.debug("Unknown proxy service type: %s", type);
      return res.status(403).json({ error: "Unknown proxy service type" });
    }

    const serviceProxyHandler = widget.proxyHandler || genericProxyHandler;

    if (serviceProxyHandler instanceof Function) {
      // quick return for no endpoint services, calendar is an exception
      if (!req.query.endpoint || serviceProxyHandler === calendarProxyHandler) {
        return await serviceProxyHandler(req, res);
      }

      // map opaque endpoints to their actual endpoint
      if (widget?.mappings) {
        const mapping = widget?.mappings?.[req.query.endpoint];
        const mappingParams = mapping?.params;
        const optionalParams = mapping?.optionalParams;
        const map = mapping?.map;
        const endpoint = mapping?.endpoint;
        const endpointProxy = mapping?.proxyHandler || serviceProxyHandler;

        if (mapping?.method && mapping.method !== req.method) {
          logger.debug("Unsupported method: %s", req.method);
          return res.status(403).json({ error: "Unsupported method" });
        }

        if (!endpoint) {
          logger.debug("Unsupported service endpoint: %s", type);
          return res.status(403).json({ error: "Unsupported service endpoint" });
        }

        let filteredRes = res;
        const mappingPerms = serviceWidget?.proxyPerms?.[req.query.endpoint] ?? serviceWidget?.proxyPerms?.["*"];
        if (mappingPerms === false) {
          return res.status(403).json({ error: "Disabled service endpoint" });
        } else if (mappingPerms !== true && mappingPerms !== undefined) {
          if (!identityAllow(perms, mappingPerms)) {
            return res.status(403).json({ error: "Insufficient permissions" });
          }
          if (mappingPerms.responseFilter) {
            const keys = mappingPerms.responseFilter
              .filter((filter) => identityAllow(perms, filter))
              .flatMap((filter) => filter.paths);
            filteredRes = new ResponseFilter(res, keys);
          }
        }

        req.method = mapping?.method || "GET";
        if (mapping?.body) req.body = mapping?.body;
        req.query.endpoint = endpoint;

        if (req.query.segments) {
          const segments = JSON.parse(req.query.segments);
          let validSegments = true;
          Object.keys(segments).forEach((key) => {
            if (!mapping.segments.includes(key)) {
              logger.debug("Unsupported segment: %s", key);
              validSegments = false;
            } else if (segments[key].includes("/") || segments[key].includes("\\") || segments[key].includes("..")) {
              logger.debug("Unsupported segment value: %s", segments[key]);
              validSegments = false;
            }
          });
          if (!validSegments) return res.status(403).json({ error: "Unsupported segment" });
          req.query.endpoint = formatApiCall(endpoint, segments);
        }

        if (req.query.query && (mappingParams || optionalParams)) {
          const queryParams = JSON.parse(req.query.query);

          let filteredOptionalParams = [];
          if (optionalParams) filteredOptionalParams = optionalParams.filter((p) => queryParams[p] !== undefined);

          let params = [];
          if (mappingParams) params = params.concat(mappingParams);
          if (filteredOptionalParams) params = params.concat(filteredOptionalParams);

          const query = new URLSearchParams(params.map((p) => [p, queryParams[p]]));
          req.query.endpoint = `${req.query.endpoint}?${query}`;
        }

        if (mapping?.headers) {
          req.extraHeaders = mapping.headers;
        }

        if (endpointProxy instanceof Function) {
          return await endpointProxy(req, filteredRes, map);
        }

        return await serviceProxyHandler(req, filteredRes, map);
      }

      if (widget.allowedEndpoints instanceof RegExp) {
        if (widget.allowedEndpoints.test(req.query.endpoint)) {
          return await serviceProxyHandler(req, res);
        }
      }

      logger.debug("Unmapped proxy request.");
      return res.status(403).json({ error: "Unmapped proxy request." });
    }

    logger.debug("Unknown proxy service type: %s", type);
    return res.status(403).json({ error: "Unknown proxy service type" });
  } catch (e) {
    if (e) logger.error(e);
    return res.status(500).send({ error: "Unexpected error" });
  }
}

import { CustomObjectsApi } from "@kubernetes/client-node";

import getConfigMapPropertyValue from "./configmap";
import getSecretPropertyValue from "./secret";

import { substituteEnvironmentVars } from "utils/config/config";
import {
  ANNOTATION_BASE,
  ANNOTATION_WIDGET_BASE,
  CONFIGMAP_REF_PREFIX,
  getKubeConfig,
  HTTPROUTE_API_GROUP,
  HTTPROUTE_API_VERSION,
  JSON_PREFIX,
  SECRET_REF_PREFIX,
} from "utils/config/kubernetes";
import * as shvl from "utils/config/shvl";
import createLogger from "utils/logger";

const logger = createLogger("resource-helpers");
const kc = getKubeConfig();

const getSchemaFromGateway = async (parentRef) => {
  const crd = kc.makeApiClient(CustomObjectsApi);
  const schema = await crd
    .getNamespacedCustomObject({
      group: HTTPROUTE_API_GROUP,
      version: HTTPROUTE_API_VERSION,
      namespace: parentRef.namespace,
      plural: "gateways",
      name: parentRef.name,
    })
    .then((response) => {
      const listener =
        response.spec.listeners.find((l) => l.name === parentRef.sectionName) ?? response.spec.listeners[0];

      return listener.protocol.toLowerCase();
    })
    .catch((error) => {
      logger.error("Error getting gateways: %d %s %s", error.statusCode, error.body, error.response);
      logger.debug(error);

      return "http";
    });

  return schema;
};

async function getUrlFromHttpRoute(resource) {
  let url = null;
  const hasHostName = resource.spec?.hostnames;

  if (hasHostName) {
    if (resource.spec.rules[0].matches[0].path.type !== "RegularExpression") {
      const urlHost = resource.spec.hostnames[0];
      const urlPath = resource.spec.rules[0].matches[0].path.value;
      const urlSchema = await getSchemaFromGateway(resource.spec.parentRefs[0]);
      url = `${urlSchema}://${urlHost}${urlPath}`;
    }
  }

  return url;
}

function getUrlFromIngress(resource) {
  const urlHost = resource.spec.rules[0].host;
  const urlPath = resource.spec.rules[0].http.paths[0].path;
  const urlSchema = resource.spec.tls ? "https" : "http";

  return `${urlSchema}://${urlHost}${urlPath}`;
}

async function getUrlSchema(resource) {
  const isHttpRoute = resource.kind === "HTTPRoute";
  let urlSchema;
  if (isHttpRoute) {
    urlSchema = getUrlFromHttpRoute(resource);
  } else {
    urlSchema = getUrlFromIngress(resource);
  }

  return urlSchema;
}

export function isDiscoverable(resource, instanceName) {
  return (
    resource.metadata.annotations &&
    resource.metadata.annotations[`${ANNOTATION_BASE}/enabled`] === "true" &&
    (!resource.metadata.annotations[`${ANNOTATION_BASE}/instance`] ||
      resource.metadata.annotations[`${ANNOTATION_BASE}/instance`] === instanceName ||
      `${ANNOTATION_BASE}/instance.${instanceName}` in resource.metadata.annotations)
  );
}

export async function constructedServiceFromResource(resource) {
  const annotations = resource.metadata.annotations;

  let constructedService = {
    type: "service",
    app: await resolveValue(annotations[`${ANNOTATION_BASE}/app`], resource.metadata.name),
    namespace: resource.metadata.namespace,
    href: await resolveValue(annotations[`${ANNOTATION_BASE}/href`], getUrlSchema(resource)),
    name: await resolveValue(annotations[`${ANNOTATION_BASE}/name`], resource.metadata.name),
    group: await resolveValue(annotations[`${ANNOTATION_BASE}/group`], "Kubernetes"),
    weight: await resolveValue(annotations[`${ANNOTATION_BASE}/weight`], "0"),
    icon: await resolveValue(annotations[`${ANNOTATION_BASE}/icon`], ""),
    description: await resolveValue(annotations[`${ANNOTATION_BASE}/description`], ""),
    external: await resolveValue(
      annotations[`${ANNOTATION_BASE}/external`],
      false,
      (v) => String(v).toLowerCase() === "true",
    ),
    podSelector: await resolveValue(annotations[`${ANNOTATION_BASE}/pod-selector`]),
    ping: await resolveValue(annotations[`${ANNOTATION_BASE}/ping`]),
    siteMonitor: await resolveValue(annotations[`${ANNOTATION_BASE}/siteMonitor`]),
    statusStyle: await resolveValue(annotations[`${ANNOTATION_BASE}/statusStyle`]),
    allowUsers: await resolveValue(annotations[`${ANNOTATION_BASE}/allowUsers`], undefined, (v) => v.split(",")),
    allowGroups: await resolveValue(annotations[`${ANNOTATION_BASE}/allowGroups`], undefined, (v) => v.split(",")),
  };

  const widgetProperties = await Promise.all(
    Object.keys(annotations)
      .filter((annotation) => annotation.startsWith(ANNOTATION_WIDGET_BASE))
      .map(async (annotation) => [
        annotation.replace(`${ANNOTATION_BASE}/`, ""),
        await resolveValue(annotations[annotation]),
      ]),
  );
  for (const [path, value] of widgetProperties) {
    shvl.set(constructedService, path, value);
  }
  if (Array.isArray(constructedService.widget)) {
    constructedService.widgets = constructedService.widget;
    constructedService.widget = undefined;
  }

  try {
    constructedService = JSON.parse(substituteEnvironmentVars(JSON.stringify(constructedService)));
  } catch (e) {
    logger.error("Error attempting k8s environment variable substitution.");
    logger.debug(e);
  }

  return constructedService;
}

async function resolveValue(value, defaultValue, transform) {
  if (value?.startsWith(CONFIGMAP_REF_PREFIX)) {
    const [namespace, name, property] = value.replace(CONFIGMAP_REF_PREFIX, "").split("/");
    const resolved = await getConfigMapPropertyValue(namespace, name, property);
    return resolveValue(resolved, defaultValue, transform);
  } else if (value?.startsWith(SECRET_REF_PREFIX)) {
    const [namespace, name, property] = value.replace(SECRET_REF_PREFIX, "").split("/");
    const resolved = await getSecretPropertyValue(namespace, name, property);
    return resolveValue(resolved, defaultValue, transform);
  } else if (value?.startsWith(JSON_PREFIX)) {
    const resolved = await resolveValue(value.replace(JSON_PREFIX, ""), defaultValue, transform);
    try {
      return JSON.parse(resolved);
    } catch (e) {
      logger.error("error json decoding value: %s", e);
    }
  } else if (value !== undefined && transform !== undefined) {
    return transform(value);
  } else {
    return value ?? defaultValue;
  }
}

"""Local MCP metadata checks based on Manufact and uml-mcp guidance.

This is not the hosted Manufact checklist and never claims directory certification.
"""

import argparse
import asyncio
import json
import math
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

HINTS = ("readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint")


class Report:
    """Collects check results in the format of the hosted checklist."""

    def __init__(self):
        self.checks: list[dict] = []

    def check(self, rule: str, target: str, ok: bool, message: str, *, skip: bool = False) -> None:
        status = "skip" if skip else "pass" if ok else "fail"
        self.checks.append(
            {"checkId": rule, "target": target, "severity": "error", "status": status, "message": message}
        )


def schema_valid(schema: dict) -> bool:
    try:
        Draft202012Validator.check_schema(schema)
    except Exception:
        return False
    return set(schema.get("required", [])) <= set(schema.get("properties", {}))


def check_tool(report: Report, tool: dict, resource_uris: set[str]) -> None:
    name, description = tool["name"], tool.get("description", "")
    schema = tool.get("inputSchema", {})
    hints = tool.get("annotations") or {}
    report.check("tool-title-present", name, bool(tool.get("title")), "Tools need a top-level display title.")
    report.check(
        "tool-description-present",
        name,
        len(description) >= 10,
        "Describe the purpose and result of the tool.",
    )
    report.check(
        "tool-name-format",
        name,
        bool(re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name)),
        "Tool names use supported characters and fit the 64-character limit.",
    )
    report.check(
        "tool-hints-present",
        name,
        all(isinstance(hints.get(k), bool) for k in HINTS),
        "Declare read-only, destructive, open-world, and idempotency hints.",
    )
    report.check("tool-input-schema-type", name, schema.get("type") == "object", "Input schema is an object.")
    for kind, candidate in (("input", schema), ("output", tool.get("outputSchema"))):
        if candidate is not None:
            report.check(
                f"tool-{kind}-schema-valid",
                name,
                schema_valid(candidate),
                "JSON Schema and required fields are valid.",
            )
    report.check(
        "prop-description",
        name,
        all(p.get("description") for p in schema.get("properties", {}).values()),
        "Every parameter has a description.",
    )
    report.check(
        "claude-code-metadata-length",
        name,
        len(description.encode()) <= 2048,
        "Description stays within 2 KB.",
    )
    report.check(
        "tool-text-hidden-characters",
        name,
        not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", name + description),
        "No hidden control characters in tool text.",
    )
    meta = tool.get("_meta") or {}
    ui = meta.get("ui", {})
    if "visibility" in ui:
        value = ui["visibility"]
        report.check(
            "tool-visibility-valid",
            name,
            bool(value) and len(value) == len(set(value)) and set(value) <= {"model", "app"},
            "Visibility contains model and/or app without duplicates.",
        )
    if "resourceUri" in ui:
        invocation = meta.get("openai/toolInvocation", {})
        report.check(
            "tool-resource-uri-readable",
            name,
            ui["resourceUri"] in resource_uris,
            "The referenced UI resource is registered.",
        )
        report.check(
            "tool-invocation-metadata-present",
            name,
            bool(invocation.get("invoking") and invocation.get("invoked")),
            "Widget tools provide invocation status labels.",
        )


def exact_origin(value: str) -> bool:
    domain = urlsplit(value)
    return (
        domain.scheme == "https"
        and bool(domain.hostname)
        and not (domain.path or domain.query or domain.fragment or domain.username)
        and "*" not in domain.netloc
    )


def check_resource(report: Report, resource: dict, html: str, publish: bool) -> None:
    uri = resource["uri"]
    report.check(
        "resource-description-present",
        uri,
        bool(resource.get("description")),
        "Resources describe their content.",
    )
    if not uri.startswith("ui://"):
        return
    report.check(
        "resource-content-valid",
        uri,
        resource.get("mimeType") == "text/html;profile=mcp-app"
        and "<html" in html
        and "<svg" not in html[:15],
        "UI resource has the MCP Apps MIME type and HTML content.",
    )
    ui = (resource.get("_meta") or {}).get("ui", {})
    csp = ui.get("csp", {})
    report.check(
        "view-csp-present",
        uri,
        isinstance(csp.get("connectDomains"), list) and isinstance(csp.get("resourceDomains"), list),
        "CSP explicitly declares connection and resource origins.",
    )
    # The compiled app has inline JS/CSS and no external script/style dependencies.
    report.check(
        "view-self-contained-assets",
        uri,
        not re.search(r'<(?:script|link)\b[^>]*(?:src|href)=["\']https?://', html),
        "The viewer bundles its scripts and styles; inspect future external assets against CSP.",
    )
    domain = ui.get("domain", "")
    report.check(
        "view-domain-present",
        uri,
        exact_origin(domain),
        "Publishing requires MCP_APP_DOMAIN set to one owned HTTPS origin.",
        skip=not publish and not urlsplit(domain).netloc,
    )


def check_prompt(report: Report, prompt: dict) -> None:
    name = prompt["name"]
    report.check(
        "prompt-description-present",
        name,
        bool(prompt.get("description")),
        "Prompts describe their workflow.",
    )
    report.check(
        "prompt-arg-description",
        name,
        all(a.get("description") for a in prompt.get("arguments", [])),
        "Prompt arguments have descriptions.",
    )


def inspect_definitions(
    tools: list[dict], resources: list[dict], prompts: list[dict], html: str, *, publish: bool = False
) -> dict:
    report = Report()
    report.check(
        "tool-names-unique", "server", len({t["name"] for t in tools}) == len(tools), "Tool names are unique."
    )
    resource_uris = {r["uri"] for r in resources}
    for tool in tools:
        check_tool(report, tool, resource_uris)
    for resource in resources:
        check_resource(report, resource, html, publish)
    for prompt in prompts:
        check_prompt(report, prompt)
    # App-only tools are hidden from the model, so they do not count toward its context.
    model_tools = [t for t in tools if (t.get("_meta") or {}).get("ui", {}).get("visibility") != ["app"]]
    estimate = math.ceil(
        len(json.dumps({"tools": model_tools, "resources": resources, "prompts": prompts})) / 4
    )
    report.check(
        "connect-token-budget",
        "server",
        estimate <= 4500,
        f"Estimated model-visible discovery: {estimate}/4500 tokens.",
    )
    return {
        "name": "Review Helper local MCP lint",
        "mode": "publish-metadata" if publish else "local",
        "passed": not any(c["status"] == "fail" for c in report.checks),
        "checks": report.checks,
        "estimated_model_tokens": estimate,
        "hosted_manufact_checklist": "not run",
        "real_chatgpt_claude_rendering": "not verified",
    }


async def run_lint(url: str | None = None, publish: bool = False) -> dict:
    if url:
        headers = (
            {"Authorization": f"Bearer {os.environ['REVIEW_HELPER_ACCESS_TOKEN']}"}
            if os.getenv("REVIEW_HELPER_ACCESS_TOKEN")
            else None
        )
        async with streamablehttp_client(url, headers=headers) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = (await session.list_tools()).tools
                resources = (await session.list_resources()).resources
                prompts = (await session.list_prompts()).prompts
                view = next(r for r in resources if str(r.uri).startswith("ui://"))
                content = await session.read_resource(view.uri)
                html = content.contents[0].text
    else:
        from .mcp_server import mcp, workspace_html

        tools, resources, prompts = (
            await mcp.list_tools(),
            await mcp.list_resources(),
            await mcp.list_prompts(),
        )
        html = workspace_html()

    def dump(values):
        return [json.loads(value.model_dump_json(by_alias=True, exclude_none=True)) for value in values]

    return inspect_definitions(dump(tools), dump(resources), dump(prompts), html, publish=publish)


def main():
    parser = argparse.ArgumentParser(description="Lint Review Helper MCP metadata locally or over HTTP.")
    parser.add_argument("--url")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--json", type=Path, dest="output")
    args = parser.parse_args()
    report = asyncio.run(run_lint(args.url, args.publish))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for check in report["checks"]:
        if check["status"] != "pass":
            print(f"{check['status'].upper()} {check['checkId']}: {check['message']}")
    print(
        f"{'PASS' if report['passed'] else 'FAIL'}: {len(report['checks'])} checks, "
        f"~{report['estimated_model_tokens']} model-visible discovery tokens."
    )
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()

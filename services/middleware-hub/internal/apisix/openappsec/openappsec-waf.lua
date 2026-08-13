-- openappsec-waf.lua
-- APISIX custom plugin that forwards each HTTP request to the openappsec-agent
-- for WAF inspection before proxying to the upstream service.
-- The agent returns a verdict (allow / block) and an optional reason string.
--
-- Configuration schema:
--   agent_url    string  (default: "http://localhost:8090")
--   fail_open    boolean (default: true)  — allow traffic if agent unreachable
--   mode         string  "prevent" | "detect"
--   min_severity string  "critical" | "high" | "medium" | "low"

local core      = require("apisix.core")
local http      = require("resty.http")
local cjson     = require("cjson.safe")

local plugin_name = "openappsec-waf"

local schema = {
    type = "object",
    properties = {
        agent_url    = { type = "string",  default = "http://localhost:8090" },
        fail_open    = { type = "boolean", default = true },
        mode         = { type = "string",  enum = {"prevent", "detect"}, default = "prevent" },
        min_severity = { type = "string",  enum = {"critical", "high", "medium", "low"}, default = "high" },
    },
}

local _M = {
    version  = 0.1,
    priority = 2900,   -- run before jwt-auth (2510) so WAF blocks first
    name     = plugin_name,
    schema   = schema,
}

function _M.check_schema(conf)
    return core.schema.check(schema, conf)
end

-- Severity ordering for threshold comparison
local SEV_ORDER = { critical = 4, high = 3, medium = 2, low = 1 }

local function severity_meets_threshold(verdict_sev, min_sev)
    return (SEV_ORDER[verdict_sev] or 0) >= (SEV_ORDER[min_sev] or 3)
end

function _M.access(conf, ctx)
    local httpc = http.new()
    httpc:set_timeout(200)  -- 200 ms max for WAF check

    -- Build inspection payload
    local req_headers = ngx.req.get_headers()
    local payload = cjson.encode({
        method      = ngx.req.get_method(),
        uri         = ngx.var.request_uri,
        remote_addr = ngx.var.remote_addr,
        headers     = req_headers,
    })

    local ok, res = pcall(function()
        return httpc:request_uri(conf.agent_url .. "/inspect", {
            method  = "POST",
            body    = payload,
            headers = {
                ["Content-Type"]   = "application/json",
                ["X-Source-Plugin"] = plugin_name,
            },
        })
    end)

    if not ok or not res then
        core.log.error("[openappsec-waf] agent unavailable; rejecting request")
        return 503, { error = "WAF agent unavailable" }
    end

    if res.status ~= 200 then
        return 503, { error = "WAF agent error: " .. tostring(res.status) }
    end

    local verdict = cjson.decode(res.body)
    if not verdict then
        return 503, { error = "WAF agent bad response" }
    end

    -- verdict.action: "allow" | "block"
    -- verdict.severity: "critical" | "high" | "medium" | "low" | nil
    -- verdict.reason: string | nil
    if verdict.action == "block" and conf.mode == "prevent" then
        local sev = verdict.severity or "high"
        if severity_meets_threshold(sev, conf.min_severity) then
            core.log.warn(string.format(
                "[openappsec-waf] BLOCKED uri=%s severity=%s reason=%s",
                ngx.var.request_uri, sev, verdict.reason or "n/a"
            ))
            return 403, {
                error    = "Request blocked by WAF",
                severity = sev,
                reason   = verdict.reason,
            }
        end
    elseif verdict.action == "block" and conf.mode == "detect" then
        core.log.warn(string.format(
            "[openappsec-waf] DETECTED (detect-only) uri=%s severity=%s reason=%s",
            ngx.var.request_uri, verdict.severity or "?", verdict.reason or "n/a"
        ))
        -- Add header so backend can log the detection
        core.request.set_header(ctx, "X-WAF-Detection", verdict.severity or "unknown")
    end
    -- allow falls through
end

return _M

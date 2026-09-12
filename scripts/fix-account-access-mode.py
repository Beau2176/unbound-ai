from pathlib import Path

path = Path("app/index.html")
html = path.read_text()


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return source.replace(old, new, 1)

html = replace_once(
    html,
    '''      productMode = normalizeProductMode(\n        data.conversation?.productMode || loadProductMode()\n      );\n      depthStyle = normalizeDepthStyle(''',
    '''      productMode = normalizeProductMode(\n        data.conversation?.productMode || loadProductMode()\n      );\n      if (productMode === "research" && !canUseCapability("web_research")) {\n        productMode = "standard";\n      }\n      depthStyle = normalizeDepthStyle(''',
    "loaded conversation product mode enforcement",
)

html = replace_once(
    html,
    '''          messages: legacy,\n          depthStyle: loadDepthStyle(),\n          productMode: loadProductMode()''',
    '''          messages: legacy,\n          depthStyle: loadDepthStyle(),\n          productMode: canUseCapability("web_research")\n            ? loadProductMode()\n            : "standard"''',
    "legacy import product mode enforcement",
)

html = replace_once(
    html,
    '''    function closeHistory() {\n      historyModal.hidden = true;\n      if (authModal.hidden) {\n        document.body.classList.remove("modal-open");\n      }\n    }''',
    '''    function closeHistory() {\n      historyModal.hidden = true;\n      if (authModal.hidden && accessModal.hidden) {\n        document.body.classList.remove("modal-open");\n      }\n    }''',
    "history modal body lock",
)

html = replace_once(
    html,
    '''    function closeAuth() {\n      authModal.hidden = true;\n      document.body.classList.remove("modal-open");\n      clearAuthFeedback();\n    }''',
    '''    function closeAuth() {\n      authModal.hidden = true;\n      if (historyModal.hidden && accessModal.hidden) {\n        document.body.classList.remove("modal-open");\n      }\n      clearAuthFeedback();\n    }''',
    "auth modal body lock",
)

html = replace_once(
    html,
    '''        researchModeButton.classList.toggle("locked", !canUseCapability("web_research"));\n        researchModeButton.title = canUseCapability("web_research") ? "Research Mode" : "Research Mode requires TOP access";''',
    '''        researchModeButton.classList.toggle("locked", !canUseCapability("web_research"));\n        researchModeButton.setAttribute(\n          "aria-disabled",\n          canUseCapability("web_research") ? "false" : "true"\n        );\n        researchModeButton.title = canUseCapability("web_research") ? "Research Mode" : "Research Mode requires TOP access";''',
    "signed-in research accessibility",
)

html = replace_once(
    html,
    '''      researchModeButton.classList.add("locked");\n      researchModeButton.title = "Research Mode requires a signed-in TOP account";''',
    '''      researchModeButton.classList.add("locked");\n      researchModeButton.setAttribute("aria-disabled", "true");\n      researchModeButton.title = "Research Mode requires a signed-in TOP account";''',
    "signed-out research accessibility",
)

path.write_text(html)
print("Saved Research mode entitlement edge cases fixed.")

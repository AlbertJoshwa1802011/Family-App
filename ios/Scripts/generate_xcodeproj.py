#!/usr/bin/env python3
"""Generate ios/Albert.xcodeproj/project.pbxproj for the Albert companion."""
from __future__ import annotations

import os
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJ = ROOT / "Albert.xcodeproj"
PROJ.mkdir(parents=True, exist_ok=True)


def uid() -> str:
    return uuid.uuid4().hex[:24].upper()


# Stable-ish IDs for readability in diffs
IDS = {k: uid() for k in [
    "root", "project", "main_group", "products", "albert_target", "widget_target", "tests_target",
    "albert_product", "widget_product", "tests_product",
    "albert_sources", "widget_sources", "tests_sources", "shared_sources",
    "albert_resources", "widget_resources",
    "albert_frameworks", "widget_frameworks", "tests_frameworks",
    "project_config_list", "albert_config_list", "widget_config_list", "tests_config_list",
    "project_debug", "project_release",
    "albert_debug", "albert_release", "widget_debug", "widget_release",
    "tests_debug", "tests_release",
    "sources_phase_albert", "sources_phase_widget", "sources_phase_tests",
    "resources_phase_albert", "resources_phase_widget",
    "frameworks_phase_albert", "frameworks_phase_widget", "frameworks_phase_tests",
    "embed_phase", "copy_embed",
    "albert_group", "widget_group", "shared_group", "tests_group", "config_group",
]}

SHARED_FILES = [
    "Shared/Config/AppConfig.swift",
    "Shared/Models/ImportantItem.swift",
    "Shared/Auth/KeychainStore.swift",
    "Shared/API/AlbertAPIClient.swift",
    "Shared/Storage/LocalCache.swift",
    "Shared/Sync/SyncManager.swift",
    "Shared/Intents/CompleteImportantItemIntent.swift",
    "Shared/Notifications/NotificationScheduler.swift",
    "Shared/DeepLink/DeepLinkRouter.swift",
]

ALBERT_FILES = [
    "Albert/AlbertApp.swift",
    "Albert/Views/SignInView.swift",
    "Albert/Views/ImportantItemsView.swift",
]

WIDGET_FILES = [
    "AlbertWidget/AlbertWidgetBundle.swift",
]

TEST_FILES = [
    "Tests/ImportantItemSortingTests.swift",
    "Tests/WidgetTimelineTests.swift",
    "Tests/AlbertAPIClientTests.swift",
    "Tests/AuthAndIntentTests.swift",
]

RESOURCE_FILES_ALBERT = [
    "Albert/Info.plist",
    "Albert/Albert.entitlements",
    "Albert/Assets.xcassets",
]

# File refs
file_refs: dict[str, str] = {}
build_files: dict[str, list[str]] = {"albert": [], "widget": [], "tests": []}


def ensure_file(path: str) -> str:
    if path not in file_refs:
        file_refs[path] = uid()
    return file_refs[path]


for p in SHARED_FILES + ALBERT_FILES + WIDGET_FILES + TEST_FILES:
    ensure_file(p)

# Also resource refs
assets_ref = ensure_file("Albert/Assets.xcassets")
albert_ent_ref = ensure_file("Albert/Albert.entitlements")
widget_ent_ref = ensure_file("AlbertWidget/AlbertWidget.entitlements")
albert_plist_ref = ensure_file("Albert/Info.plist")
widget_plist_ref = ensure_file("AlbertWidget/Info.plist")

# Build file IDs
bf: dict[str, str] = {}


def bf_id(target: str, path: str) -> str:
    key = f"{target}:{path}"
    if key not in bf:
        bf[key] = uid()
    return bf[key]


pbx_build_file_lines = []
pbx_file_ref_lines = []

for path, ref in sorted(file_refs.items()):
    name = Path(path).name
    explicit = ""
    if path.endswith(".plist"):
        ftype = "text.plist.xml"
    elif path.endswith(".entitlements"):
        ftype = "text.plist.entitlements"
    elif path.endswith(".xcassets"):
        ftype = "folder.assetcatalog"
    elif path.endswith(".swift"):
        ftype = "sourcecode.swift"
    else:
        ftype = "text"
    pbx_file_ref_lines.append(
        f'\t\t{ref} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = {ftype}; path = {name}; sourceTree = "<group>"; }};'
    )

# Products
pbx_file_ref_lines.append(
    f'\t\t{IDS["albert_product"]} /* Albert.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Albert.app; sourceTree = BUILT_PRODUCTS_DIR; }};'
)
pbx_file_ref_lines.append(
    f'\t\t{IDS["widget_product"]} /* AlbertWidget.appex */ = {{isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = AlbertWidget.appex; sourceTree = BUILT_PRODUCTS_DIR; }};'
)
pbx_file_ref_lines.append(
    f'\t\t{IDS["tests_product"]} /* AlbertTests.xctest */ = {{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = AlbertTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }};'
)

for path in SHARED_FILES + ALBERT_FILES:
    bid = bf_id("albert", path)
    pbx_build_file_lines.append(
        f'\t\t{bid} /* {Path(path).name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_refs[path]} /* {Path(path).name} */; }};'
    )
    build_files["albert"].append(bid)

for path in SHARED_FILES + WIDGET_FILES:
    bid = bf_id("widget", path)
    pbx_build_file_lines.append(
        f'\t\t{bid} /* {Path(path).name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_refs[path]} /* {Path(path).name} */; }};'
    )
    build_files["widget"].append(bid)

for path in SHARED_FILES + TEST_FILES:
    # Tests compile against Albert app module via @testable — only test files in test target.
    if path in TEST_FILES:
        bid = bf_id("tests", path)
        pbx_build_file_lines.append(
            f'\t\t{bid} /* {Path(path).name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_refs[path]} /* {Path(path).name} */; }};'
        )
        build_files["tests"].append(bid)

assets_bf = uid()
pbx_build_file_lines.append(
    f'\t\t{assets_bf} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {assets_ref} /* Assets.xcassets */; }};'
)

embed_bf = uid()
pbx_build_file_lines.append(
    f'\t\t{embed_bf} /* AlbertWidget.appex in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {IDS["widget_product"]} /* AlbertWidget.appex */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};'
)

# Groups — nested by folder
# We'll flatten groups for simplicity: Albert/, AlbertWidget/, Shared/, Tests/

def group_children(paths: list[str]) -> str:
    # Group by parent directory one level
    return "".join(f'\n\t\t\t\t{file_refs[p]} /* {Path(p).name} */,' for p in paths)


# Actually Shared has subdirs - list all with path relative using nested groups is nicer.
# Keep flat groups with path = folder.

shared_children = "".join(f'\n\t\t\t\t{file_refs[p]} /* {Path(p).name} */,' for p in SHARED_FILES)
# Problem: file refs have path = name only, so groups need correct path hierarchy.

# Fix: set file ref path to full relative path from ios/
pbx_file_ref_lines = []
for path, ref in sorted(file_refs.items()):
    name = Path(path).name
    if path.endswith(".plist"):
        ftype = "text.plist.xml"
    elif path.endswith(".entitlements"):
        ftype = "text.plist.entitlements"
    elif path.endswith(".xcassets"):
        ftype = "folder.assetcatalog"
    elif path.endswith(".swift"):
        ftype = "sourcecode.swift"
    else:
        ftype = "text"
    pbx_file_ref_lines.append(
        f'\t\t{ref} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = {ftype}; name = {name}; path = {path}; sourceTree = "<group>"; }};'
    )
pbx_file_ref_lines.append(
    f'\t\t{IDS["albert_product"]} /* Albert.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Albert.app; sourceTree = BUILT_PRODUCTS_DIR; }};'
)
pbx_file_ref_lines.append(
    f'\t\t{IDS["widget_product"]} /* AlbertWidget.appex */ = {{isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = AlbertWidget.appex; sourceTree = BUILT_PRODUCTS_DIR; }};'
)
pbx_file_ref_lines.append(
    f'\t\t{IDS["tests_product"]} /* AlbertTests.xctest */ = {{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = AlbertTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }};'
)

sources_albert = "\n".join(f"\t\t\t\t{bf_id('albert', p)} /* {Path(p).name} in Sources */," for p in SHARED_FILES + ALBERT_FILES)
sources_widget = "\n".join(f"\t\t\t\t{bf_id('widget', p)} /* {Path(p).name} in Sources */," for p in SHARED_FILES + WIDGET_FILES)
sources_tests = "\n".join(f"\t\t\t\t{bf_id('tests', p)} /* {Path(p).name} in Sources */," for p in TEST_FILES)

all_file_refs_in_main = "".join(
    f'\n\t\t\t\t{ref} /* {Path(path).name} */,' for path, ref in sorted(file_refs.items())
)

content = f'''// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{
	}};
	objectVersion = 56;
	objects = {{

/* Begin PBXBuildFile section */
{chr(10).join(pbx_build_file_lines)}
/* End PBXBuildFile section */

/* Begin PBXCopyFilesBuildPhase section */
		{IDS["embed_phase"]} /* Embed Foundation Extensions */ = {{
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 13;
			files = (
				{embed_bf} /* AlbertWidget.appex in Embed Foundation Extensions */,
			);
			name = "Embed Foundation Extensions";
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXCopyFilesBuildPhase section */

/* Begin PBXFileReference section */
{chr(10).join(pbx_file_ref_lines)}
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		{IDS["frameworks_phase_albert"]} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{IDS["frameworks_phase_widget"]} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{IDS["frameworks_phase_tests"]} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		{IDS["main_group"]} = {{
			isa = PBXGroup;
			children = (
				{IDS["albert_group"]} /* Albert */,
				{IDS["widget_group"]} /* AlbertWidget */,
				{IDS["shared_group"]} /* Shared */,
				{IDS["tests_group"]} /* Tests */,
				{IDS["products"]} /* Products */,
			);
			sourceTree = "<group>";
		}};
		{IDS["products"]} /* Products */ = {{
			isa = PBXGroup;
			children = (
				{IDS["albert_product"]} /* Albert.app */,
				{IDS["widget_product"]} /* AlbertWidget.appex */,
				{IDS["tests_product"]} /* AlbertTests.xctest */,
			);
			name = Products;
			sourceTree = "<group>";
		}};
		{IDS["albert_group"]} /* Albert */ = {{
			isa = PBXGroup;
			children = (
{"".join(f'{chr(10)}				{file_refs[p]} /* {Path(p).name} */,' for p in ALBERT_FILES)}
				{assets_ref} /* Assets.xcassets */,
				{albert_ent_ref} /* Albert.entitlements */,
				{albert_plist_ref} /* Info.plist */,
			);
			name = Albert;
			sourceTree = "<group>";
		}};
		{IDS["widget_group"]} /* AlbertWidget */ = {{
			isa = PBXGroup;
			children = (
{"".join(f'{chr(10)}				{file_refs[p]} /* {Path(p).name} */,' for p in WIDGET_FILES)}
				{widget_ent_ref} /* AlbertWidget.entitlements */,
				{widget_plist_ref} /* Info.plist */,
			);
			name = AlbertWidget;
			sourceTree = "<group>";
		}};
		{IDS["shared_group"]} /* Shared */ = {{
			isa = PBXGroup;
			children = (
{"".join(f'{chr(10)}				{file_refs[p]} /* {Path(p).name} */,' for p in SHARED_FILES)}
			);
			name = Shared;
			sourceTree = "<group>";
		}};
		{IDS["tests_group"]} /* Tests */ = {{
			isa = PBXGroup;
			children = (
{"".join(f'{chr(10)}				{file_refs[p]} /* {Path(p).name} */,' for p in TEST_FILES)}
			);
			name = Tests;
			sourceTree = "<group>";
		}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		{IDS["albert_target"]} /* Albert */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {IDS["albert_config_list"]} /* Build configuration list for PBXNativeTarget "Albert" */;
			buildPhases = (
				{IDS["sources_phase_albert"]} /* Sources */,
				{IDS["frameworks_phase_albert"]} /* Frameworks */,
				{IDS["resources_phase_albert"]} /* Resources */,
				{IDS["embed_phase"]} /* Embed Foundation Extensions */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = Albert;
			productName = Albert;
			productReference = {IDS["albert_product"]} /* Albert.app */;
			productType = "com.apple.product-type.application";
		}};
		{IDS["widget_target"]} /* AlbertWidget */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {IDS["widget_config_list"]} /* Build configuration list for PBXNativeTarget "AlbertWidget" */;
			buildPhases = (
				{IDS["sources_phase_widget"]} /* Sources */,
				{IDS["frameworks_phase_widget"]} /* Frameworks */,
				{IDS["resources_phase_widget"]} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = AlbertWidget;
			productName = AlbertWidget;
			productReference = {IDS["widget_product"]} /* AlbertWidget.appex */;
			productType = "com.apple.product-type.app-extension";
		}};
		{IDS["tests_target"]} /* AlbertTests */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {IDS["tests_config_list"]} /* Build configuration list for PBXNativeTarget "AlbertTests" */;
			buildPhases = (
				{IDS["sources_phase_tests"]} /* Sources */,
				{IDS["frameworks_phase_tests"]} /* Frameworks */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = AlbertTests;
			productName = AlbertTests;
			productReference = {IDS["tests_product"]} /* AlbertTests.xctest */;
			productType = "com.apple.product-type.bundle.unit-test";
		}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		{IDS["project"]} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1600;
				LastUpgradeCheck = 1600;
				TargetAttributes = {{
					{IDS["albert_target"]} = {{
						CreatedOnToolsVersion = 16.0;
					}};
					{IDS["widget_target"]} = {{
						CreatedOnToolsVersion = 16.0;
					}};
					{IDS["tests_target"]} = {{
						CreatedOnToolsVersion = 16.0;
						TestTargetID = {IDS["albert_target"]};
					}};
				}};
			}};
			buildConfigurationList = {IDS["project_config_list"]} /* Build configuration list for PBXProject "Albert" */;
			compatibilityVersion = "Xcode 15.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = {IDS["main_group"]};
			productRefGroup = {IDS["products"]} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				{IDS["albert_target"]} /* Albert */,
				{IDS["widget_target"]} /* AlbertWidget */,
				{IDS["tests_target"]} /* AlbertTests */,
			);
		}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		{IDS["resources_phase_albert"]} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{assets_bf} /* Assets.xcassets in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{IDS["resources_phase_widget"]} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		{IDS["sources_phase_albert"]} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
{sources_albert}
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{IDS["sources_phase_widget"]} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
{sources_widget}
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{IDS["sources_phase_tests"]} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
{sources_tests}
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		{IDS["project_debug"]} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_TESTABILITY = YES;
				GCC_DYNAMIC_NO_PIC = NO;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
				SWIFT_VERSION = 5.0;
			}};
			name = Debug;
		}};
		{IDS["project_release"]} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_VERSION = 5.0;
				VALIDATE_PRODUCT = YES;
			}};
			name = Release;
		}};
		{IDS["albert_debug"]} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_ENTITLEMENTS = Albert/Albert.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = Albert/Info.plist;
				INFOPLIST_KEY_CFBundleDisplayName = Albert;
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.albert.familyvault;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				SWIFT_EMIT_LOC_STRINGS = YES;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{IDS["albert_release"]} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_ENTITLEMENTS = Albert/Albert.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = Albert/Info.plist;
				INFOPLIST_KEY_CFBundleDisplayName = Albert;
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.albert.familyvault;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				SWIFT_EMIT_LOC_STRINGS = YES;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
		{IDS["widget_debug"]} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = AlbertWidget/AlbertWidget.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = AlbertWidget/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.albert.familyvault.widget;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SWIFT_EMIT_LOC_STRINGS = YES;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{IDS["widget_release"]} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = AlbertWidget/AlbertWidget.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = AlbertWidget/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.albert.familyvault.widget;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SWIFT_EMIT_LOC_STRINGS = YES;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
		{IDS["tests_debug"]} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				BUNDLE_LOADER = "$(TEST_HOST)";
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = YES;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.albert.familyvault.tests;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SWIFT_EMIT_LOC_STRINGS = NO;
				TARGETED_DEVICE_FAMILY = "1,2";
				TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Albert.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Albert";
			}};
			name = Debug;
		}};
		{IDS["tests_release"]} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				BUNDLE_LOADER = "$(TEST_HOST)";
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				GENERATE_INFOPLIST_FILE = YES;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.albert.familyvault.tests;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SWIFT_EMIT_LOC_STRINGS = NO;
				TARGETED_DEVICE_FAMILY = "1,2";
				TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Albert.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Albert";
			}};
			name = Release;
		}};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		{IDS["project_config_list"]} /* Build configuration list for PBXProject "Albert" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{IDS["project_debug"]} /* Debug */,
				{IDS["project_release"]} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{IDS["albert_config_list"]} /* Build configuration list for PBXNativeTarget "Albert" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{IDS["albert_debug"]} /* Debug */,
				{IDS["albert_release"]} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{IDS["widget_config_list"]} /* Build configuration list for PBXNativeTarget "AlbertWidget" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{IDS["widget_debug"]} /* Debug */,
				{IDS["widget_release"]} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{IDS["tests_config_list"]} /* Build configuration list for PBXNativeTarget "AlbertTests" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{IDS["tests_debug"]} /* Debug */,
				{IDS["tests_release"]} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
/* End XCConfigurationList section */
	}};
	rootObject = {IDS["project"]} /* Project object */;
}}
'''

(PROJ / "project.pbxproj").write_text(content)
print(f"Wrote {PROJ / 'project.pbxproj'}")

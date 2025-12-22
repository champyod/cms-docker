#!/usr/bin/env python3
import sys
import os
import sys
import os
try:
    import tomli as toml
except ImportError:
    # For Python 3.11+
    import tomllib as toml

def check_type(config, section, key, expected_type, allow_optional=False):
    """Checks the type of a key in a section."""
    if section not in config:
        if allow_optional:
            return True
        print(f"ERROR: Missing section [{section}]")
        return False
    
    if key not in config[section]:
        if allow_optional:
            return True
        print(f"ERROR: Missing key '{key}' in section [{section}]")
        return False
    
    value = config[section][key]
    if not isinstance(value, expected_type):
        print(f"ERROR: Incorrect type for {section}.{key}: expected {expected_type.__name__}, got {type(value).__name__} (value: {value})")
        return False
    
    return True

def validate_config(config_path):
    if not os.path.exists(config_path):
        print(f"ERROR: Config file not found at {config_path}")
        return False
    
    try:
        with open(config_path, "rb") as f:
            config = toml.load(f)
    except Exception as e:
        print(f"ERROR: Failed to parse TOML file: {e}")
        return False
    
    errors = 0
    
    # 1. Check [database]
    if not check_type(config, 'database', 'url', str): errors += 1
    
    # 2. Check [services] (Topology)
    # Services should be lists of lists: [["host", port], ...]
    if 'services' in config:
        for service, instances in config['services'].items():
            if not isinstance(instances, list):
                print(f"ERROR: [services].{service} must be a list of instances, got {type(instances).__name__}")
                errors += 1
                continue
            for i, instance in enumerate(instances):
                if not isinstance(instance, list) or len(instance) < 2:
                    print(f"ERROR: [services].{service}[{i}] must be [hostname, port]")
                    errors += 1
    else:
        print("ERROR: Missing [services] section - required for CMS topology.")
        errors += 1

    # 3. Check Web Servers (Types are critical here)
    # AdminWebServer: Single string/int
    if not check_type(config, 'admin_web_server', 'listen_address', str): errors += 1
    if not check_type(config, 'admin_web_server', 'listen_port', int): errors += 1
    
    # ContestWebServer: List of strings/ints
    if not check_type(config, 'contest_web_server', 'listen_address', list): errors += 1
    if not check_type(config, 'contest_web_server', 'listen_port', list): errors += 1
    
    # 4. Check Proxy Service
    if not check_type(config, 'proxy_service', 'listen_port', int): errors += 1
    if not check_type(config, 'proxy_service', 'rankings', list): errors += 1
    
    if errors > 0:
        print(f"\nValidation FAILED with {errors} errors.")
        return False
    
    print("\nValidation PASSED: configuration looks correct.")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 validate_config.py <path_to_cms.toml>")
        sys.exit(1)
        
    config_path = sys.argv[1]
    if not validate_config(config_path):
        sys.exit(1)
    sys.exit(0)

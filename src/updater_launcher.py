import os
import subprocess
import time
import sys

def main():
    print("========================================")
    print("      Study Helper Auto-Updater")
    print("========================================")
    
    # 1. Update Check
    try:
        # Check if .git exists
        if not os.path.isdir(".git"):
            print("Warning: Not a git repository. Skipping update.")
        else:
            print("Checking for updates...")
            # Fetch latest
            subprocess.run(["git", "fetch", "origin", "main"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # Check status
            status = subprocess.check_output(["git", "status", "-uno"], encoding="utf-8")
            if "behind" in status:
                print(">>> New version found! Updating...")
                subprocess.run(["git", "pull", "origin", "main"], check=True)
                print(">>> Update successful!")
            else:
                print(">>> You are on the latest version.")
                
    except Exception as e:
        print(f"Update check failed: {e}")
        print("Proceeding with local version...")
    
    print("\nStarting application...")
    time.sleep(1)

    # 2. Run Application
    # Entry point: src/ai_drill/web_server.py
    script_path = os.path.join("src", "ai_drill", "web_server.py")
    
    if not os.path.exists(script_path):
        print(f"Error: Critical file not found: {script_path}")
        print("Please check your installation.")
        input("Press Enter to exit...")
        return

    try:
        # Run using system 'python'. Assuming user has python installed.
        cmd = ["python", script_path]
        
        # If we want to open browser automatically, web_server.py presumably does it or we can do it here.
        # web_server.py usually runs a blocking server.
        subprocess.run(cmd, check=True)
        
    except KeyboardInterrupt:
        print("\nExiting...")
    except Exception as e:
        print(f"\nError running application: {e}")
        input("Press Enter to exit...")

if __name__ == "__main__":
    main()

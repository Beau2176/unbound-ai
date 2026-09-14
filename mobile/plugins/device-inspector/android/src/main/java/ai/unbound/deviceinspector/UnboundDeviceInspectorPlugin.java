package ai.unbound.deviceinspector;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "UnboundDeviceInspector")
public class UnboundDeviceInspectorPlugin extends Plugin {

    @PluginMethod
    public void requestAccess(PluginCall call) {
        JSArray scopes = call.getArray("scopes", new JSArray());
        JSObject result = new JSObject();
        result.put("granted", true);
        result.put("scopes", scopes);
        call.resolve(result);
    }

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        try {
            Context context = getContext();
            JSObject result = new JSObject();
            result.put("platform", "android");
            result.put("system", getSystemSnapshot(context));
            result.put("apps", getLaunchableApps(context));
            result.put("processes", getVisibleProcesses(context));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Device inspection failed.", error);
        }
    }

    private JSObject getSystemSnapshot(Context context) {
        JSObject system = new JSObject();
        system.put("osVersion", "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        system.put("cpuCores", Runtime.getRuntime().availableProcessors());

        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memoryInfo = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memoryInfo);
        system.put("memoryTotalMb", Math.round(memoryInfo.totalMem / 1048576.0));
        system.put("memoryAvailableMb", Math.round(memoryInfo.availMem / 1048576.0));

        File storageRoot = Environment.getDataDirectory();
        StatFs statFs = new StatFs(storageRoot.getAbsolutePath());
        long totalBytes = statFs.getBlockCountLong() * statFs.getBlockSizeLong();
        long freeBytes = statFs.getAvailableBlocksLong() * statFs.getBlockSizeLong();
        system.put("storageTotalMb", Math.round(totalBytes / 1048576.0));
        system.put("storageAvailableMb", Math.round(freeBytes / 1048576.0));

        BatteryManager battery = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
        int percent = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        system.put("batteryPercent", percent >= 0 ? percent : null);
        system.put("charging", battery.isCharging());
        return system;
    }

    private JSArray getLaunchableApps(Context context) {
        PackageManager pm = context.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN, null);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(launcher, PackageManager.MATCH_ALL);
        JSArray output = new JSArray();
        Set<String> seen = new HashSet<>();
        int count = 0;
        for (ResolveInfo info : apps) {
            if (count >= 100 || info.activityInfo == null) break;
            String packageName = info.activityInfo.packageName;
            if (!seen.add(packageName)) continue;
            CharSequence labelValue = info.loadLabel(pm);
            JSObject item = new JSObject();
            item.put("name", labelValue == null ? packageName : labelValue.toString());
            item.put("packageName", packageName);
            output.put(item);
            count++;
        }
        return output;
    }

    private JSArray getVisibleProcesses(Context context) {
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        JSArray output = new JSArray();
        if (processes == null) return output;
        int count = 0;
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (count >= 100) break;
            JSObject item = new JSObject();
            item.put("name", process.processName);
            item.put("processName", process.processName);
            output.put(item);
            count++;
        }
        return output;
    }
}

# Fixed read-only probe. Persistent mode reuses compiled sensor code.
param([switch]$Watch, [int]$IntervalSeconds = 5)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ProgressPreference = 'SilentlyContinue'
try {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class BonfireAdl {
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate IntPtr Alloc(int size);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public struct Adapter {
    public int size, index;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string udid;
    public int bus, device, function, vendor;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string display;
    public int present, exist;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string driverPath;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string driverPathExt;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string pnp;
    public int displayIndex;
  }
  [DllImport("atiadlxx.dll", CallingConvention=CallingConvention.Cdecl)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] static extern int ADL2_Main_Control_Create(Alloc callback,int connected,out IntPtr context);
  [DllImport("atiadlxx.dll", CallingConvention=CallingConvention.Cdecl)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] static extern int ADL2_Main_Control_Destroy(IntPtr context);
  [DllImport("atiadlxx.dll", CallingConvention=CallingConvention.Cdecl)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] static extern int ADL2_Adapter_NumberOfAdapters_Get(IntPtr context,out int count);
  [DllImport("atiadlxx.dll", CallingConvention=CallingConvention.Cdecl)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] static extern int ADL2_Adapter_AdapterInfo_Get(IntPtr context,IntPtr buffer,int size);
  [DllImport("atiadlxx.dll", CallingConvention=CallingConvention.Cdecl)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] static extern int ADL2_New_QueryPMLogData_Get(IntPtr context,int index,IntPtr output);
  static object Sensor(IntPtr data,int id,int low,int high) {
    int offset=4+id*8;
    if(Marshal.ReadInt32(data,offset)==0)return null;
    int value=Marshal.ReadInt32(data,offset+4);
    return value>=low&&value<=high?(object)value:null;
  }
  public static object[] Read() {
    var result=new List<object>(); var seen=new HashSet<string>();
    IntPtr context=IntPtr.Zero, info=IntPtr.Zero, output=IntPtr.Zero;
    var allocations=new List<IntPtr>();
    Alloc allocator=size=>{var ptr=Marshal.AllocHGlobal(size);allocations.Add(ptr);return ptr;};
    try {
      if(ADL2_Main_Control_Create(allocator,1,out context)!=0)throw new Exception("AMD ADL initialization unavailable");
      int count; if(ADL2_Adapter_NumberOfAdapters_Get(context,out count)!=0||count<1||count>32)throw new Exception("AMD adapter list unavailable");
      int size=Marshal.SizeOf(typeof(Adapter)); info=Marshal.AllocHGlobal(size*count);
      Marshal.Copy(new byte[size*count],0,info,size*count);
      for(int i=0;i<count;i++)Marshal.WriteInt32(info,i*size,size);
      if(ADL2_Adapter_AdapterInfo_Get(context,info,size*count)!=0)throw new Exception("AMD adapter details unavailable");
      output=Marshal.AllocHGlobal(4+256*8);
      for(int i=0;i<count;i++){
        var adapter=(Adapter)Marshal.PtrToStructure(IntPtr.Add(info,i*size),typeof(Adapter));
        if(adapter.present==0||!(adapter.vendor==1002||adapter.vendor==0x1002))continue;
        string key=adapter.bus+":"+adapter.device+":"+adapter.function;
        if(!seen.Add(key))continue;
        Marshal.Copy(new byte[4+256*8],0,output,4+256*8); Marshal.WriteInt32(output,4+256*8);
        int status=ADL2_New_QueryPMLogData_Get(context,adapter.index,output);
        result.Add(new Dictionary<string,object>{{"name",adapter.name},{"source","AMD ADL PMLog"},{"driver_status",status},
          {"load_pct",status==0?Sensor(output,19,0,100):null},{"temperature_c",status==0?Sensor(output,8,1,150):null},
          {"hotspot_c",status==0?Sensor(output,27,1,150):null},{"fan_rpm",status==0?Sensor(output,14,0,20000):null},
          {"core_clock_mhz",status==0?Sensor(output,1,0,10000):null}});
      }
    } finally {
      if(context!=IntPtr.Zero)ADL2_Main_Control_Destroy(context);
      if(info!=IntPtr.Zero)Marshal.FreeHGlobal(info);if(output!=IntPtr.Zero)Marshal.FreeHGlobal(output);
      foreach(var ptr in allocations)Marshal.FreeHGlobal(ptr);
      GC.KeepAlive(allocator);
    }
    return result.ToArray();
  }
}
'@ | Out-Null
} catch { }

function Get-BonfireSnapshot {
$notes = [System.Collections.Generic.List[string]]::new()
$gpuSensors = @()
try { $gpuSensors = @([BonfireAdl]::Read()) } catch { $notes.Add('AMD driver sensor query unavailable. Temperatures are not inferred from load.') }

$cpuLoad = $null; $cpuTemp = $null; $memory = $null; $gpuNames = @(); $gpuEngines = @(); $gpuMemory = @()
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $memory = @{ total_gib=[Math]::Round($os.TotalVisibleMemorySize / 1MB,2); used_gib=[Math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory) / 1MB,2) }
    $cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
    if ($null -ne $cpu.PercentProcessorTime) { $cpuLoad = [double]$cpu.PercentProcessorTime }
    $gpuNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
} catch { $notes.Add('Windows CPU/memory snapshot unavailable.') }
try {
    $samples = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop)
    $groups = $samples | Group-Object { $_.Name -replace '^pid_\d+_', '' }
    $gpuEngines = @($groups | ForEach-Object {
        @{ engine=$_.Name; utilization_pct=[Math]::Round([Math]::Min(100,($_.Group | Measure-Object UtilizationPercentage -Sum).Sum),1) }
    } | Sort-Object { $_.utilization_pct } -Descending | Select-Object -First 6)
    # A busiest engine, not the sum of 3D/compute/copy engines, represents activity.
} catch { $notes.Add('Windows GPU counters unavailable (counter names may be localized).') }
try {
    $samples = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction Stop)
    $gpuMemory = @($samples | ForEach-Object { @{ adapter=$_.Name; dedicated_used_gib=[Math]::Round($_.DedicatedUsage / 1GB,3) } })
} catch { $notes.Add('Windows GPU memory counter unavailable.') }
try {
    $sensors = @(Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop)
    $sensor = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -match '/cpu/' -and $_.Name -match 'Package|Tctl|Tdie' } | Select-Object -First 1
    if ($null -ne $sensor.Value -and $sensor.Value -gt 0 -and $sensor.Value -lt 150) { $cpuTemp=[double]$sensor.Value }
} catch { }
if ($null -eq $cpuTemp) { $notes.Add('CPU temperature unavailable: no supported LibreHardwareMonitor package sensor is exposed. ACPI zones are not treated as CPU temperatures.') }
@{ captured_at=(Get-Date).ToUniversalTime().ToString('o'); cpu=@{ load_pct=$cpuLoad; temperature_c=$cpuTemp }; memory=$memory; gpu_names=$gpuNames; amd_gpus=$gpuSensors; windows_gpu_engines=$gpuEngines; windows_gpu_memory=$gpuMemory; notes=@($notes) } | ConvertTo-Json -Depth 6 -Compress
}
do {
    $sampleStarted = [DateTime]::UtcNow
    Get-BonfireSnapshot
    if ($Watch) { Start-Sleep -Milliseconds ([Math]::Max(50, ([Math]::Max(2, $IntervalSeconds) * 1000) - ([DateTime]::UtcNow - $sampleStarted).TotalMilliseconds)) }
} while ($Watch)

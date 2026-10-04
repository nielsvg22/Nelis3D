/**
 * Printer integration seam (P2 – NOT enabled in this version).
 *
 * Reality check: a printer needs sliced G-code, not a mesh. A direct "send to printer" therefore needs
 *   1. a slicer step (CrealityPrint/OrcaSlicer CLI in a worker container, with a K1 Max profile), and
 *   2. a transport. The K1 Max runs Klipper; Moonraker's HTTP API (`POST /server/files/upload`,
 *      `POST /printer/print/start`) is the natural transport on a local network.
 * Because the app runs in the cloud/phone, the connector must run next to the printer (small LAN agent)
 * or via a tunnel. Until then the supported, reliable path is “Download 3MF for Creality Print”.
 */
export interface PrinterConnector {
  readonly id: string;
  /** upload sliced G-code and optionally start the print */
  sendGcode(input: { host: string; filename: string; gcode: Uint8Array; start: boolean }): Promise<{ ok: boolean; message?: string }>;
  status(host: string): Promise<{ state: "idle" | "printing" | "error" | "offline"; progress?: number }>;
}

export interface Slicer {
  readonly id: string;
  slice(input: { threeMf: Uint8Array; printerId: string; material: string }): Promise<{ gcode: Uint8Array; estimatedSeconds?: number }>;
}

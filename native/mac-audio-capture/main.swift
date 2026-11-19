import AudioToolbox
import CoreAudio
import Foundation

/// Clean-room macOS 14.2+ Core Audio Process Tap CLI.
/// Captures global system output audio, mixes down to mono, linearly resamples
/// to the target sample rate (default 16000 Hz), and streams signed 16-bit LE PCM
/// chunks to stdout while writing structured JSON lifecycle messages to stderr.

private func emitLog(_ type: String, _ payload: [String: Any] = [:]) {
    var msg = payload
    msg["type"] = type
    if let data = try? JSONSerialization.data(withJSONObject: msg),
       var line = String(data: data, encoding: .utf8) {
        line.append("\n")
        if let bytes = line.data(using: .utf8) {
            FileHandle.standardError.write(bytes)
        }
    }
}

private func getDefaultOutputDeviceUID() -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var deviceID: AudioObjectID = kAudioObjectUnknown
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size,
        &deviceID
    )
    guard status == noErr, deviceID != kAudioObjectUnknown else { return nil }

    var uidAddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var uidRef: Unmanaged<CFString>?
    var uidSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let uidStatus = AudioObjectGetPropertyData(deviceID, &uidAddr, 0, nil, &uidSize, &uidRef)
    guard uidStatus == noErr, let cfStr = uidRef?.takeRetainedValue() else { return nil }
    return cfStr as String
}

private final class ResamplingChunkWriter: @unchecked Sendable {
    private let sourceRate: Double
    private let targetRate: Double
    private let chunkSamples: Int
    private let step: Double
    private var phase: Double = 0
    private var prevSample: Float = 0
    private var hasPrev: Bool = false
    private var outBuffer: [Int16] = []
    private let stdout = FileHandle.standardOutput

    init(sourceRate: Double, targetRate: Double, chunkDuration: Double) {
        self.sourceRate = max(sourceRate, 8000)
        self.targetRate = max(targetRate, 8000)
        self.step = self.sourceRate / self.targetRate
        self.chunkSamples = max(160, Int(self.targetRate * max(0.02, chunkDuration)))
        self.outBuffer.reserveCapacity(self.chunkSamples * 2)
    }

    func pushMonoFloat(_ samples: [Float]) {
        guard !samples.isEmpty else { return }
        var pos = phase
        let count = samples.count

        while pos < Double(count) {
            let idx = Int(pos)
            let frac = Float(pos - Double(idx))
            let s0: Float
            if idx == 0 && hasPrev && pos < 1.0 {
                s0 = prevSample
            } else {
                s0 = samples[min(idx, count - 1)]
            }
            let s1 = samples[min(idx + 1, count - 1)]
            let interp = s0 + (s1 - s0) * frac
            let clamped = max(-1.0, min(1.0, interp))
            let pcm = Int16(clamped * 32767.0)
            outBuffer.append(pcm.littleEndian)
            pos += step
        }

        phase = pos - Double(count)
        prevSample = samples[count - 1]
        hasPrev = true

        while outBuffer.count >= chunkSamples {
            let slice = Array(outBuffer.prefix(chunkSamples))
            outBuffer.removeFirst(chunkSamples)
            slice.withUnsafeBytes { raw in
                if let base = raw.baseAddress {
                    stdout.write(Data(bytes: base, count: raw.count))
                }
            }
        }
    }
}

@available(macOS 14.2, *)
private final class TapRunner: @unchecked Sendable {
    private var tapID: AudioObjectID = kAudioObjectUnknown
    private var aggregateID: AudioObjectID = kAudioObjectUnknown
    private var ioProcID: AudioDeviceIOProcID?
    private var writer: ResamplingChunkWriter?
    private let targetSampleRate: Double
    private let chunkDuration: Double
    private var stopped = false

    init(targetSampleRate: Double, chunkDuration: Double) {
        self.targetSampleRate = targetSampleRate
        self.chunkDuration = chunkDuration
    }

    func start() throws {
        let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        tapDesc.name = "GlassHUD System Audio Tap"
        tapDesc.isPrivate = true
        tapDesc.isExclusive = true
        tapDesc.muteBehavior = .unmuted

        var createdTapID: AudioObjectID = kAudioObjectUnknown
        let tapStatus = AudioHardwareCreateProcessTap(tapDesc, &createdTapID)
        guard tapStatus == noErr else {
            throw NSError(
                domain: "MacAudioCapture",
                code: Int(tapStatus),
                userInfo: [NSLocalizedDescriptionKey: "AudioHardwareCreateProcessTap failed (OSStatus \(tapStatus)). Grant System Audio Recording permission in System Settings."]
            )
        }
        tapID = createdTapID

        var formatAddr = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var asbd = AudioStreamBasicDescription()
        var asbdSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let fmtStatus = AudioObjectGetPropertyData(tapID, &formatAddr, 0, nil, &asbdSize, &asbd)
        let sourceRate = (fmtStatus == noErr && asbd.mSampleRate > 0) ? asbd.mSampleRate : 48000.0
        let channels = max(1, Int(asbd.mChannelsPerFrame))
        let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0

        let tapUUID = tapDesc.uuid.uuidString
        var aggDesc: [String: Any] = [
            kAudioAggregateDeviceNameKey: "GlassHUD Aggregate Tap",
            kAudioAggregateDeviceUIDKey: "com.glasshud.aggregate.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapUIDKey: tapUUID,
                    kAudioSubTapDriftCompensationKey: true
                ]
            ]
        ]

        if let outUID = getDefaultOutputDeviceUID() {
            aggDesc[kAudioAggregateDeviceMainSubDeviceKey] = outUID
            aggDesc[kAudioAggregateDeviceSubDeviceListKey] = [
                [kAudioSubDeviceUIDKey: outUID]
            ]
        }

        var createdAggID: AudioObjectID = kAudioObjectUnknown
        let aggStatus = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &createdAggID)
        guard aggStatus == noErr else {
            cleanup()
            throw NSError(
                domain: "MacAudioCapture",
                code: Int(aggStatus),
                userInfo: [NSLocalizedDescriptionKey: "AudioHardwareCreateAggregateDevice failed (OSStatus \(aggStatus))."]
            )
        }
        aggregateID = createdAggID

        let chunkWriter = ResamplingChunkWriter(
            sourceRate: sourceRate,
            targetRate: targetSampleRate,
            chunkDuration: chunkDuration
        )
        writer = chunkWriter

        let queue = DispatchQueue(label: "com.glasshud.audio-io", qos: .userInteractive)
        var procID: AudioDeviceIOProcID?
        let procStatus = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { _, inInputData, _, _, _ in
            let bufferList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
            guard !bufferList.isEmpty else { return }

            if isNonInterleaved && bufferList.count >= 1 {
                guard bufferList[0].mData != nil else { return }
                let frameCount = Int(bufferList[0].mDataByteSize) / MemoryLayout<Float>.size
                guard frameCount > 0 else { return }
                var mono = [Float](repeating: 0, count: frameCount)
                let bufCount = bufferList.count
                let scale = 1.0 / Float(bufCount)
                for b in 0..<bufCount {
                    if let ptr = bufferList[b].mData?.assumingMemoryBound(to: Float.self) {
                        let count = min(frameCount, Int(bufferList[b].mDataByteSize) / MemoryLayout<Float>.size)
                        for i in 0..<count {
                            mono[i] += ptr[i] * scale
                        }
                    }
                }
                chunkWriter.pushMonoFloat(mono)
            } else {
                let buf = bufferList[0]
                guard let ptr = buf.mData?.assumingMemoryBound(to: Float.self) else { return }
                let ch = max(1, Int(buf.mNumberChannels > 0 ? Int(buf.mNumberChannels) : channels))
                let totalFloats = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
                let frameCount = totalFloats / ch
                guard frameCount > 0 else { return }
                var mono = [Float](repeating: 0, count: frameCount)
                let scale = 1.0 / Float(ch)
                for i in 0..<frameCount {
                    var sum: Float = 0
                    for c in 0..<ch {
                        sum += ptr[i * ch + c]
                    }
                    mono[i] = sum * scale
                }
                chunkWriter.pushMonoFloat(mono)
            }
        }

        guard procStatus == noErr, let validProc = procID else {
            cleanup()
            throw NSError(
                domain: "MacAudioCapture",
                code: Int(procStatus),
                userInfo: [NSLocalizedDescriptionKey: "AudioDeviceCreateIOProcIDWithBlock failed (OSStatus \(procStatus))."]
            )
        }
        ioProcID = validProc

        let startStatus = AudioDeviceStart(aggregateID, validProc)
        guard startStatus == noErr else {
            cleanup()
            throw NSError(
                domain: "MacAudioCapture",
                code: Int(startStatus),
                userInfo: [NSLocalizedDescriptionKey: "AudioDeviceStart failed (OSStatus \(startStatus))."]
            )
        }

        emitLog("stream_start", [
            "sourceSampleRate": sourceRate,
            "targetSampleRate": targetSampleRate,
            "channels": channels
        ])
    }

    func cleanup() {
        if stopped { return }
        stopped = true
        if let proc = ioProcID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, proc)
            AudioDeviceDestroyIOProcID(aggregateID, proc)
            ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
        }
    }
}

@main
struct MacAudioCaptureCLI {
    static func main() {
        var sampleRate: Double = 16000
        var chunkDuration: Double = 0.05

        let args = CommandLine.arguments
        var i = 1
        while i < args.count {
            if args[i] == "--sample-rate", i + 1 < args.count, let val = Double(args[i + 1]) {
                sampleRate = val
                i += 2
            } else if args[i] == "--chunk-duration", i + 1 < args.count, let val = Double(args[i + 1]) {
                chunkDuration = val
                i += 2
            } else {
                i += 1
            }
        }

        guard #available(macOS 14.2, *) else {
            emitLog("error", ["message": "System audio capture requires macOS 14.2 or later."])
            exit(1)
        }

        let runner = TapRunner(targetSampleRate: sampleRate, chunkDuration: chunkDuration)
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)

        let sigInt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        let sigTerm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        let shutdown: () -> Void = {
            runner.cleanup()
            emitLog("stream_stop")
            exit(0)
        }
        sigInt.setEventHandler(handler: shutdown)
        sigTerm.setEventHandler(handler: shutdown)
        sigInt.resume()
        sigTerm.resume()

        do {
            try runner.start()
            dispatchMain()
        } catch {
            emitLog("error", ["message": error.localizedDescription])
            runner.cleanup()
            exit(1)
        }
    }
}

Imports System.IO
Imports System.IO.Compression
Imports System.Security.Cryptography
Imports System.Text

Namespace Services

    ''' <summary>
    ''' Archivio .zip protetto da password con la cifratura tradizionale PKWARE (ZipCrypto): si apre con
    ''' Esplora risorse di Windows, 7-Zip, WinRAR e simili. Non è una cifratura robusta: serve a evitare
    ''' aperture accidentali dei dati di diagnostica. Voci compresse (deflate) o memorizzate, senza Zip64.
    ''' </summary>
    Public NotInheritable Class EncryptedZipWriter

        Private Class Entry
            Public Name As Byte()
            Public Crc As UInteger
            Public CompSize As UInteger
            Public Size As UInteger
            Public Offset As UInteger
            Public Method As UShort
        End Class

        Private Shared ReadOnly CrcTable As UInteger() = BuildCrcTable()
        Private ReadOnly _out As New MemoryStream()
        Private ReadOnly _pwd As Byte()
        Private ReadOnly _entries As New List(Of Entry)()
        Private ReadOnly _time As UShort, _date As UShort

        Public Sub New(password As String)
            _pwd = Encoding.UTF8.GetBytes(If(password, ""))
            Dim n = DateTime.Now
            _time = CUShort((n.Hour << 11) Or (n.Minute << 5) Or (n.Second \ 2))
            _date = CUShort(((Math.Max(1980, n.Year) - 1980) << 9) Or (n.Month << 5) Or n.Day)
        End Sub

        Private Shared Function BuildCrcTable() As UInteger()
            Dim t(255) As UInteger
            For i = 0 To 255
                Dim c = CUInt(i)
                For k = 0 To 7
                    c = If((c And 1UI) <> 0, &HEDB88320UI Xor (c >> 1), c >> 1)
                Next
                t(i) = c
            Next
            Return t
        End Function

        Private Shared Function CrcByte(crc As UInteger, b As Byte) As UInteger
            Return CrcTable(CInt((crc Xor b) And &HFFUI)) Xor (crc >> 8)
        End Function

        Public Shared Function Crc32(data As Byte()) As UInteger
            Dim c = &HFFFFFFFFUI
            For Each b In data
                c = CrcByte(c, b)
            Next
            Return c Xor &HFFFFFFFFUI
        End Function

        ''' <summary>Chiavi della cifratura ZipCrypto (stato per voce).</summary>
        Private Structure Keys
            Public K0 As UInteger, K1 As UInteger, K2 As UInteger

            Public Sub Init(pwd As Byte())
                K0 = &H12345678UI : K1 = &H23456789UI : K2 = &H34567890UI
                For Each b In pwd
                    Update(b)
                Next
            End Sub

            Public Sub Update(b As Byte)
                K0 = CrcByte(K0, b)
                K1 = CUInt(((CULng(K1) + (K0 And &HFFUI)) * 134775813UL + 1UL) And &HFFFFFFFFUL)
                K2 = CrcByte(K2, CByte(K1 >> 24))
            End Sub

            Public Function Encrypt(b As Byte) As Byte
                Dim tmp = (K2 Or 2UI) And &HFFFFUI
                Dim k = CByte(((tmp * (tmp Xor 1UI)) >> 8) And &HFFUI)
                Update(b)
                Return CByte(b Xor k)
            End Function
        End Structure

        ''' <summary>Aggiunge un file (percorso con "/" come separatore).</summary>
        Public Sub Add(name As String, data As Byte())
            Dim crc = Crc32(data)
            Dim payload As Byte()
            Dim method As UShort = 8
            Using ms As New MemoryStream()
                Using ds As New DeflateStream(ms, CompressionLevel.Optimal, True)
                    ds.Write(data, 0, data.Length)
                End Using
                payload = ms.ToArray()
            End Using
            If payload.Length >= data.Length Then payload = data : method = 0
            ' intestazione di cifratura: 11 byte casuali + byte alto del CRC (verifica della password)
            Dim head(11) As Byte
            RandomNumberGenerator.Fill(head)
            head(11) = CByte(crc >> 24)
            Dim keys As New Keys()
            keys.Init(_pwd)
            Dim enc(head.Length + payload.Length - 1) As Byte
            For i = 0 To head.Length - 1
                enc(i) = keys.Encrypt(head(i))
            Next
            For i = 0 To payload.Length - 1
                enc(head.Length + i) = keys.Encrypt(payload(i))
            Next
            Dim e As New Entry With {
                .Name = Encoding.UTF8.GetBytes(name), .Crc = crc, .CompSize = CUInt(enc.Length), .Size = CUInt(data.Length),
                .Offset = CUInt(_out.Position), .Method = method}
            Using w As New BinaryWriter(_out, Encoding.UTF8, True)
                w.Write(&H4034B50UI)
                w.Write(CUShort(20))
                w.Write(CUShort(&H801))          ' cifrato + nomi in UTF-8
                w.Write(e.Method)
                w.Write(_time) : w.Write(_date)
                w.Write(e.Crc) : w.Write(e.CompSize) : w.Write(e.Size)
                w.Write(CUShort(e.Name.Length)) : w.Write(CUShort(0))
                w.Write(e.Name)
                w.Write(enc)
            End Using
            _entries.Add(e)
        End Sub

        Public Sub Add(name As String, text As String)
            Add(name, Encoding.UTF8.GetBytes(text))
        End Sub

        ''' <summary>Scrive la directory centrale e ritorna l'archivio completo.</summary>
        Public Function ToArray() As Byte()
            Dim cdStart = CUInt(_out.Position)
            Using w As New BinaryWriter(_out, Encoding.UTF8, True)
                For Each e In _entries
                    w.Write(&H2014B50UI)
                    w.Write(CUShort(20)) : w.Write(CUShort(20))
                    w.Write(CUShort(&H801))
                    w.Write(e.Method)
                    w.Write(_time) : w.Write(_date)
                    w.Write(e.Crc) : w.Write(e.CompSize) : w.Write(e.Size)
                    w.Write(CUShort(e.Name.Length)) : w.Write(CUShort(0)) : w.Write(CUShort(0))
                    w.Write(CUShort(0)) : w.Write(CUShort(0)) : w.Write(0UI)
                    w.Write(e.Offset)
                    w.Write(e.Name)
                Next
                Dim cdSize = CUInt(_out.Position) - cdStart
                w.Write(&H6054B50UI)
                w.Write(CUShort(0)) : w.Write(CUShort(0))
                w.Write(CUShort(_entries.Count)) : w.Write(CUShort(_entries.Count))
                w.Write(cdSize) : w.Write(cdStart)
                w.Write(CUShort(0))
            End Using
            Return _out.ToArray()
        End Function

    End Class

End Namespace

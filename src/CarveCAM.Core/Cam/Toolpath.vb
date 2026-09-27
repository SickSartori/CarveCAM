Imports CarveCAM.Core.Geometry
Imports CarveCAM.Core.Model

Namespace Cam

    Public Enum MoveType As Byte
        Rapid = 0
        Feed = 1
        Plunge = 2
        ''' <summary>Discesa in rampa o elica (avanzamento di rampa).</summary>
        Ramp = 3
    End Enum

    ''' <summary>Punto del percorso in coordinate locali del piano (u,v,w) e tipo di movimento per raggiungerlo.</summary>
    Public Structure CLPoint
        Public U As Double
        Public V As Double
        Public W As Double
        Public Type As MoveType

        Public Sub New(u As Double, v As Double, w As Double, type As MoveType)
            Me.U = u : Me.V = v : Me.W = w : Me.Type = type
        End Sub
    End Structure

    Public NotInheritable Class ToolpathStats
        Public Property PointCount As Integer
        Public Property FeedLength As Double
        Public Property RapidLength As Double
        Public Property PlungeLength As Double
        Public Property RampLength As Double
        ''' <summary>Ingressi eseguiti: a rampa, a elica, con affondo verticale.</summary>
        Public Property RampEntries As Integer
        Public Property HelixEntries As Integer
        Public Property PlungeEntries As Integer
        Public Property EstimatedMinutes As Double
        Public Property Levels As Integer
        Public Property Triangles As Integer
        Public Property Resolution As Double
        Public Property SafeW As Double
        Public Property ComputeMs As Long
        ''' <summary>Massima penetrazione rilevata dalla verifica (mm), 0 = nessuna.</summary>
        Public Property MaxGouge As Double
        Public Property GougeSamples As Integer
    End Class

    ''' <summary>Percorso utensile calcolato per una lavorazione.</summary>
    Public NotInheritable Class Toolpath
        Public Property Id As String
        Public Property OperationId As String
        Public Property Name As String
        Public Property Kind As String
        Public Property Strategy As String
        Public Property Tool As ToolDef
        Public Property Feed As Double
        Public Property Plunge As Double
        Public Property RampFeed As Double
        Public Property Spindle As Double
        Public Property SafeW As Double
        Public Property Frame As PlaneFrame
        Public ReadOnly Property Points As New List(Of CLPoint)()
        Public ReadOnly Property Warnings As New List(Of String)()
        Public Property Stats As New ToolpathStats()

        Public Function WorldPoint(i As Integer) As Vec3
            Dim p = Points(i)
            Return Frame.ToWorld(p.U, p.V, p.W)
        End Function

        ''' <summary>Formato binario per il client: int32 n, n*3 float32 (x,y,z mondo), n byte tipo.</summary>
        Public Function ToBinary() As Byte()
            Dim n = Points.Count
            Dim bytes(4 + n * 12 + n - 1) As Byte
            BitConverter.TryWriteBytes(bytes.AsSpan(0, 4), n)
            For i = 0 To n - 1
                Dim w = WorldPoint(i)
                BitConverter.TryWriteBytes(bytes.AsSpan(4 + i * 12, 4), CSng(w.X))
                BitConverter.TryWriteBytes(bytes.AsSpan(8 + i * 12, 4), CSng(w.Y))
                BitConverter.TryWriteBytes(bytes.AsSpan(12 + i * 12, 4), CSng(w.Z))
                bytes(4 + n * 12 + i) = CByte(Points(i).Type)
            Next
            Return bytes
        End Function

        Public Sub ComputeStats(Optional rapidRate As Double = 5000)
            Dim fl = 0.0, rl = 0.0, pl = 0.0, ral = 0.0
            For i = 1 To Points.Count - 1
                Dim a = Points(i - 1), b = Points(i)
                Dim d = Math.Sqrt((b.U - a.U) ^ 2 + (b.V - a.V) ^ 2 + (b.W - a.W) ^ 2)
                Select Case b.Type
                    Case MoveType.Rapid : rl += d
                    Case MoveType.Feed : fl += d
                    Case MoveType.Plunge : pl += d
                    Case MoveType.Ramp : ral += d
                End Select
            Next
            Stats.PointCount = Points.Count
            Stats.FeedLength = fl : Stats.RapidLength = rl : Stats.PlungeLength = pl : Stats.RampLength = ral
            Stats.EstimatedMinutes = fl / Math.Max(1, Feed) + pl / Math.Max(1, Plunge) + ral / Math.Max(1, RampFeed) + rl / rapidRate
        End Sub
    End Class

    ''' <summary>Costruttore incrementale del percorso che evita punti duplicati.</summary>
    Public NotInheritable Class PathBuilder
        Private ReadOnly _tp As Toolpath
        Private _has As Boolean
        Private _cur As CLPoint

        Public Sub New(tp As Toolpath)
            _tp = tp
        End Sub

        Public ReadOnly Property HasCurrent As Boolean
            Get
                Return _has
            End Get
        End Property

        Public ReadOnly Property Current As CLPoint
            Get
                Return _cur
            End Get
        End Property

        Public Sub Move(u As Double, v As Double, w As Double, t As MoveType)
            If _has AndAlso Math.Abs(_cur.U - u) < 0.000001 AndAlso Math.Abs(_cur.V - v) < 0.000001 AndAlso Math.Abs(_cur.W - w) < 0.000001 Then Return
            _cur = New CLPoint(u, v, w, t)
            _has = True
            _tp.Points.Add(_cur)
        End Sub

        Public Sub Rapid(u As Double, v As Double, w As Double)
            Move(u, v, w, MoveType.Rapid)
        End Sub

        Public Sub Feed(u As Double, v As Double, w As Double)
            Move(u, v, w, MoveType.Feed)
        End Sub

        Public Sub Plunge(u As Double, v As Double, w As Double)
            Move(u, v, w, MoveType.Plunge)
        End Sub

        Public Sub Ramp(u As Double, v As Double, w As Double)
            Move(u, v, w, MoveType.Ramp)
        End Sub

        ''' <summary>Disimpegno alla quota di sicurezza, spostamento in rapido e riposizionamento sopra il punto.</summary>
        Public Sub RetractTo(u As Double, v As Double, safeW As Double, approachW As Double)
            If _has Then Rapid(_cur.U, _cur.V, safeW)
            Rapid(u, v, safeW)
            If approachW < safeW Then Rapid(u, v, approachW)
        End Sub
    End Class

End Namespace
